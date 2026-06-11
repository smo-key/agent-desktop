//! Resolve a usable `PATH` for child processes (`claude`, `gh`, shells).
//!
//! macOS GUI apps launched from Finder/Dock inherit a *sparse* launchd `PATH`
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits `~/.local/bin`, Homebrew, nvm,
//! etc. So `claude` — installed at `~/.local/bin/claude` — is not found and a
//! pane "doesn't launch", even though it works under `tauri dev` (which inherits
//! the terminal's full interactive `PATH`).
//!
//! The previous seeding (`std::env::var("PATH").unwrap_or_else(default)`) only
//! used its fallback when `PATH` was *entirely unset*; a sparse-but-present
//! `PATH` slipped through unchanged, so the bug bit every Finder launch.
//!
//! We recover the real `PATH` the way other GUI dev tools do: ask the user's
//! login shell once (`$SHELL -ilc 'printf … "$PATH"'`, so both `.zprofile` and
//! `.zshrc` are sourced), then UNION it with the current process `PATH` and a
//! set of well-known bin dirs as a safety net. The result is cached for the
//! process lifetime.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

const SENTINEL_START: &str = "__AGENTDESKTOP_PATH__";
const SENTINEL_END: &str = "__END__";

/// Max time we let the login shell run before giving up and falling back to the
/// well-known dirs. A correctly configured shell resolves in well under this; the
/// bound only protects against a profile that blocks (e.g. waits on input).
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);

static RESOLVED_PATH: OnceLock<String> = OnceLock::new();

/// The `PATH` to seed into child processes. Computed once, then cached.
///
/// Guaranteed to include `~/.local/bin` and the common Homebrew/standard dirs
/// even when the login-shell probe fails, so `claude` is discoverable from a
/// sparse GUI environment.
pub fn resolved_path() -> &'static str {
    RESOLVED_PATH.get_or_init(compute_path).as_str()
}

/// Build the seeded `PATH` by unioning, in priority order: the login-shell
/// `PATH` (best — matches `tauri dev`), the current process `PATH`, then a
/// well-known safety net (`~/.local/bin`, `~/.cargo/bin`, Homebrew, standard).
fn compute_path() -> String {
    let login = login_shell_path().unwrap_or_default();
    let process = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    let local_bin = format!("{home}/.local/bin");
    let cargo_bin = format!("{home}/.cargo/bin");
    const WELL_KNOWN: &str =
        "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

    let mut sources: Vec<&str> = vec![&login, &process];
    if !home.is_empty() {
        sources.push(&local_bin);
        sources.push(&cargo_bin);
    }
    sources.push(WELL_KNOWN);
    merge_path_sources(&sources)
}

/// Merge colon-separated `PATH` strings into one, preserving first-seen order
/// and dropping empty/duplicate entries. Pure — the load-bearing core.
fn merge_path_sources(sources: &[&str]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for src in sources {
        for dir in src.split(':') {
            if dir.is_empty() {
                continue;
            }
            if seen.insert(dir) {
                out.push(dir);
            }
        }
    }
    out.join(":")
}

/// Probe the user's login shell for its `PATH`. Returns `None` on any failure
/// (no shell, spawn error, timeout, missing markers) so the caller falls back to
/// the well-known dirs. The sentinel framing lets us extract `PATH` even when the
/// profile prints other noise to stdout.
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // `-i -l`: interactive + login, so zsh sources both `.zprofile` and `.zshrc`
    // (the Claude Code installer appends `~/.local/bin` to the interactive rc).
    let script = format!("printf '{SENTINEL_START}%s{SENTINEL_END}' \"$PATH\"");
    let mut child = std::process::Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    // Bounded wait so a misconfigured profile can't hang the first spawn. PATH is
    // tiny (well under the pipe buffer), so the child won't block on a full pipe.
    let deadline = Instant::now() + SHELL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }

    use std::io::Read;
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    extract_sentinel_path(&out)
}

/// Extract the `PATH` framed by the sentinels from shell output, ignoring any
/// surrounding profile noise. Pure. `None` if the markers are absent or the
/// captured value is empty.
fn extract_sentinel_path(output: &str) -> Option<String> {
    let start = output.find(SENTINEL_START)? + SENTINEL_START.len();
    let rest = &output[start..];
    let end = rest.find(SENTINEL_END)?;
    let path = &rest[..end];
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_dedupes_preserving_first_seen_order() {
        let merged = merge_path_sources(&["/a:/b", "/b:/c", "/a:/d"]);
        assert_eq!(merged, "/a:/b:/c:/d");
    }

    #[test]
    fn merge_drops_empty_segments() {
        // Leading/trailing/double colons must not yield empty PATH entries (an
        // empty entry means "current dir" to the shell — a security/footgun).
        let merged = merge_path_sources(&[":/a::", "", "/b:"]);
        assert_eq!(merged, "/a:/b");
    }

    #[test]
    fn merge_recovers_local_bin_from_sparse_process_path() {
        // The bug: a sparse Finder PATH lacks ~/.local/bin where claude lives.
        // The well-known union must restore it (and Homebrew) regardless.
        let sparse = "/usr/bin:/bin:/usr/sbin:/sbin";
        let well_known = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
        let merged = merge_path_sources(&[sparse, "/Users/x/.local/bin", well_known]);
        let dirs: Vec<&str> = merged.split(':').collect();
        assert!(dirs.contains(&"/Users/x/.local/bin"), "claude dir missing: {merged}");
        assert!(dirs.contains(&"/opt/homebrew/bin"), "homebrew missing: {merged}");
        // Sparse dirs still present, but only once each.
        assert_eq!(dirs.iter().filter(|d| **d == "/usr/bin").count(), 1);
    }

    #[test]
    fn extract_finds_path_between_sentinels_amid_noise() {
        let out = format!(
            "some rc banner\n{SENTINEL_START}/opt/homebrew/bin:/Users/x/.local/bin{SENTINEL_END}trailing"
        );
        assert_eq!(
            extract_sentinel_path(&out).as_deref(),
            Some("/opt/homebrew/bin:/Users/x/.local/bin")
        );
    }

    #[test]
    fn extract_is_none_without_markers_or_when_empty() {
        assert_eq!(extract_sentinel_path("no markers here"), None);
        let empty = format!("{SENTINEL_START}{SENTINEL_END}");
        assert_eq!(extract_sentinel_path(&empty), None);
    }

    #[test]
    fn resolved_path_always_contains_standard_and_local_dirs() {
        // Integration-ish: whatever the environment, the seeded PATH must carry
        // the safety-net dirs so a sparse GUI launch can still find claude.
        let p = resolved_path();
        let dirs: Vec<&str> = p.split(':').collect();
        assert!(dirs.contains(&"/usr/bin"), "missing /usr/bin: {p}");
        if let Ok(home) = std::env::var("HOME") {
            let local = format!("{home}/.local/bin");
            assert!(dirs.contains(&local.as_str()), "missing ~/.local/bin: {p}");
        }
    }
}
