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

/// The `PATH` entry separator for the host: `:` on Unix, `;` on Windows.
/// A Windows `PATH` joined with colons would split `C:\…` mid-drive-letter.
const SEP: char = if cfg!(windows) { ';' } else { ':' };

/// The user's home directory, from `HOME` on Unix and `USERPROFILE` on Windows
/// (where `HOME` is normally unset). Empty when neither is set.
///
/// Shared by every caller that seeds or forwards a child's home (`pr::seed_gh_env`,
/// `claude_title::seed_claude_env`, and `~` expansion in `lib.rs`).
pub fn home_dir() -> String {
    match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => h,
        // Not `#[cfg(windows)]`-gated: reading USERPROFILE is harmless on Unix
        // (unset there) and keeps one code path.
        _ => std::env::var("USERPROFILE").unwrap_or_default(),
    }
}

/// The program a NEW shell pane launches when the user has expressed no
/// preference (`shell-selection` capability).
///
/// Windows prefers PowerShell 7 (`pwsh`) and falls back to Windows PowerShell
/// (`powershell.exe`), which is present on every install. Unix honors `$SHELL`
/// and falls back to `/bin/zsh` — unchanged from the previous hardcoded default.
///
/// Resolved in Rust rather than the frontend because only the backend can see
/// the real process environment and probe `PATH` for `pwsh`.
pub fn default_shell() -> String {
    if cfg!(windows) {
        // `pwsh` is on PATH only when PowerShell 7+ is installed.
        if which_on_path("pwsh").is_some() {
            "pwsh".to_string()
        } else {
            "powershell.exe".to_string()
        }
    } else {
        match std::env::var("SHELL") {
            Ok(s) if !s.is_empty() => s,
            _ => "/bin/zsh".to_string(),
        }
    }
}

/// First directory on the seeded `PATH` containing `program` (with the platform's
/// executable extensions), or `None`. Used to decide whether `pwsh` exists.
fn which_on_path(program: &str) -> Option<std::path::PathBuf> {
    let exts: &[&str] = if cfg!(windows) {
        &[".exe", ".cmd", ""]
    } else {
        &[""]
    };
    for dir in resolved_path().split(SEP) {
        if dir.is_empty() {
            continue;
        }
        for ext in exts {
            let candidate = std::path::Path::new(dir).join(format!("{program}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Build the seeded `PATH` by unioning, in priority order: the login-shell
/// `PATH` (best — matches `tauri dev`; Unix only), the current process `PATH`,
/// then a platform-appropriate well-known safety net.
fn compute_path() -> String {
    // No login-shell probe on Windows: there is no `$SHELL -ilc` equivalent, and
    // the process PATH there is already the full user+system PATH rather than the
    // sparse launchd one that motivated the probe on macOS.
    let login = if cfg!(windows) {
        String::new()
    } else {
        login_shell_path().unwrap_or_default()
    };
    let process = std::env::var("PATH").unwrap_or_default();
    let home = home_dir();
    compose_path(&login, &process, &home, cfg!(windows))
}

/// Assemble the seeded `PATH` from its inputs. Pure, and takes `windows`
/// explicitly so BOTH platform layouts are unit-testable from any host.
fn compose_path(login: &str, process: &str, home: &str, windows: bool) -> String {
    let sep = if windows { ';' } else { ':' };
    // Where `claude`/`node` actually land per platform.
    let (user_bins, well_known): (Vec<String>, &str) = if windows {
        (
            vec![
                format!(r"{home}\AppData\Local\Programs"),
                format!(r"{home}\AppData\Roaming\npm"),
                format!(r"{home}\.local\bin"),
                format!(r"{home}\.cargo\bin"),
            ],
            r"C:\Windows\system32;C:\Windows;C:\Windows\System32\Wbem;C:\Program Files\nodejs;C:\Program Files\Git\cmd",
        )
    } else {
        (
            vec![format!("{home}/.local/bin"), format!("{home}/.cargo/bin")],
            "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        )
    };

    let mut sources: Vec<&str> = vec![login, process];
    if !home.is_empty() {
        sources.extend(user_bins.iter().map(String::as_str));
    }
    sources.push(well_known);
    merge_path_sources_with(&sources, sep)
}

/// Merge `PATH` strings using the HOST separator, preserving first-seen order and
/// dropping empty/duplicate entries. Pure — the load-bearing core.
fn merge_path_sources(sources: &[&str]) -> String {
    merge_path_sources_with(sources, SEP)
}

/// [`merge_path_sources`] with an explicit separator, so the Windows layout can
/// be exercised from a Unix host.
fn merge_path_sources_with(sources: &[&str], sep: char) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for src in sources {
        for dir in src.split(sep) {
            if dir.is_empty() {
                continue;
            }
            if seen.insert(dir) {
                out.push(dir);
            }
        }
    }
    out.join(&sep.to_string())
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

    /// A pane's child on Windows gets a semicolon-separated PATH pointing at the
    /// Windows locations where `claude`/`node` live — and none of the Unix ones.
    #[test]
    fn path_is_usable_on_windows() {
        let path = compose_path(
            "",
            r"C:\Windows\system32;C:\Windows",
            r"C:\Users\dev",
            true,
        );
        let dirs: Vec<&str> = path.split(';').collect();

        // Semicolon-joined, and the drive letters survived intact (a colon join
        // would have split `C:\…` in half).
        assert!(dirs.iter().all(|d| d.contains('\\') || d.contains(':')), "{path}");
        assert!(dirs.contains(&r"C:\Windows\system32"), "system32 missing: {path}");

        // Where the Claude CLI and node actually install on Windows.
        assert!(
            dirs.contains(&r"C:\Users\dev\AppData\Local\Programs"),
            "user programs dir missing: {path}"
        );
        assert!(
            dirs.contains(&r"C:\Users\dev\AppData\Roaming\npm"),
            "npm global dir missing: {path}"
        );
        assert!(dirs.contains(&r"C:\Program Files\nodejs"), "nodejs missing: {path}");

        // No Unix-only directories leak onto a Windows PATH.
        assert!(!path.contains("/opt/homebrew"), "homebrew leaked: {path}");
        assert!(!path.contains("/usr/bin"), "unix bin leaked: {path}");
    }

    /// The macOS composition is byte-for-byte what it was before the
    /// cross-platform split: login PATH first, then process, then `~/.local/bin`,
    /// `~/.cargo/bin`, then the Homebrew/standard safety net.
    #[test]
    fn macos_path_resolution_is_unchanged() {
        let login = "/opt/homebrew/bin:/Users/x/.local/bin";
        let sparse = "/usr/bin:/bin:/usr/sbin:/sbin";
        let got = compose_path(login, sparse, "/Users/x", false);

        let expected = merge_path_sources_with(
            &[
                login,
                sparse,
                "/Users/x/.local/bin",
                "/Users/x/.cargo/bin",
                "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            ],
            ':',
        );
        assert_eq!(got, expected);

        // And the property that motivated the probe still holds: a sparse Finder
        // PATH still ends up with the dir `claude` lives in.
        let dirs: Vec<&str> = got.split(':').collect();
        assert!(dirs.contains(&"/Users/x/.local/bin"), "claude dir missing: {got}");
        assert_eq!(dirs.iter().filter(|d| **d == "/usr/bin").count(), 1, "deduped");
    }

    /// `HOME` is normally unset on Windows; the home directory must come from
    /// `USERPROFILE` so children that depend on it get a real path.
    #[test]
    fn home_directory_resolves_on_windows() {
        // Pure composition proof: given a Windows-style home, every user bin dir
        // is rooted at it rather than at an empty string.
        let path = compose_path("", "", r"C:\Users\dev", true);
        assert!(
            path.contains(r"C:\Users\dev\AppData\Roaming\npm"),
            "home not applied: {path}"
        );

        // An absent home must not synthesize bogus root-relative entries.
        let none = compose_path("", "", "", true);
        assert!(!none.contains(r"\AppData\"), "fabricated home dirs: {none}");

        // And the resolver itself prefers HOME, falling back to USERPROFILE.
        // (Serialized via the env, so read both back through one call.)
        let resolved = home_dir();
        let expected = std::env::var("HOME")
            .ok()
            .filter(|h| !h.is_empty())
            .or_else(|| std::env::var("USERPROFILE").ok())
            .unwrap_or_default();
        assert_eq!(resolved, expected);
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
