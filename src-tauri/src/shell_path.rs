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

use std::collections::HashMap;
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
    // On Windows `USERPROFILE` WINS over `HOME`. Git Bash / MSYS2 / Cygwin (and
    // some AD roaming profiles) set `HOME` to a POSIX-style value like
    // `/c/Users/dev`; preferring it would make `compose_path` build entries such
    // as `/c/Users/dev\AppData\Roaming\npm`, which Win32 resolves relative to the
    // current drive and never matches the real npm-global dir where `claude.cmd`
    // lives — i.e. the safety net would omit exactly what it exists to find.
    if cfg!(windows) {
        if let Ok(p) = std::env::var("USERPROFILE") {
            if !p.is_empty() {
                return p;
            }
        }
    }
    match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => h,
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

/// Whether `program` resolves on the seeded `PATH` (`agent-backends`: the
/// Settings install-detection hint). A bare name only — anything containing a
/// path separator is rejected rather than probed.
pub fn program_on_path(program: &str) -> bool {
    if program.is_empty() || program.contains('/') || program.contains('\\') {
        return false;
    }
    which_on_path(program).is_some()
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
            // Must include the directories holding BOTH shells `default_shell`
            // can return, or the "always present" powershell.exe fallback is not
            // actually resolvable from the safety net.
            concat!(
                r"C:\Windows\system32;C:\Windows;C:\Windows\System32\Wbem;",
                r"C:\Windows\System32\WindowsPowerShell\v1.0;",
                r"C:\Program Files\PowerShell\7;",
                r"C:\Program Files\nodejs;C:\Program Files\Git\cmd"
            ),
        )
    } else {
        (
            // `~/.npm-global/bin` is a common npm-prefix target where the
            // Copilot CLI (`@github/copilot`) lands; nvm-managed node dirs are
            // versioned and unguessable, but those flow in via the login-shell
            // probe.
            vec![
                format!("{home}/.local/bin"),
                format!("{home}/.cargo/bin"),
                format!("{home}/.npm-global/bin"),
            ],
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

/// Merge `PATH` strings with an explicit separator, preserving first-seen order
/// and dropping empty/duplicate entries. Pure — the load-bearing core.
///
/// The separator is always passed in, never taken from the host: a host-dependent
/// wrapper made these tests assert Unix semantics that silently inverted on
/// Windows (a `:`-joined fixture split on `;` merges nothing), and `cargo test`
/// never runs on Windows to catch it.
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


// ---------------------------------------------------------------------------
// Agent-executable detection (`wsl-agent-launch`).
// ---------------------------------------------------------------------------

/// Programs we probe for. `node` is in the list because the statusline wrapper is
/// invoked as `node "<path>"` — and under WSL that is the DISTRO's node, a
/// different install from any Windows one. VERIFIED on the reporting user's box:
/// `claude` and `copilot` resolve under `~/.local/bin` while `node` is absent
/// entirely (the agent CLIs ship as self-contained binaries), so retaining the
/// statusline there would have configured a command that silently never runs.
const PROBED_PROGRAMS: [&str; 3] = ["claude", "copilot", "node"];

/// Where each probed program was found, or `None` when it was not.
///
/// ADVISORY throughout: this fills the settings placeholder and supplies the
/// default. A failed, timed-out or empty probe must never block a launch.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct AgentExecutables {
    pub claude: Option<String>,
    pub copilot: Option<String>,
    pub node: Option<String>,
}

/// Cache keyed by the PROBE TARGET, not the process.
///
/// `resolved_path` can use a `OnceLock` because `PATH` cannot change under it.
/// These paths CAN change: they are a function of the shell preference, and the
/// requirement is that the settings placeholder shows the value detected "based
/// on the shell". A process-lifetime cache would leave a Linux path on display
/// after the user switched back to `pwsh`.
static AGENT_EXES: OnceLock<std::sync::Mutex<HashMap<String, AgentExecutables>>> = OnceLock::new();

fn agent_exe_cache() -> &'static std::sync::Mutex<HashMap<String, AgentExecutables>> {
    AGENT_EXES.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// Detect each agent CLI where the configured shell implies: inside the distro
/// when `wsl` is set, otherwise on the host `PATH`.
///
/// `wsl` and `distro` are computed by the frontend's `$lib/shell/wsl` module
/// rather than re-derived here — the launcher heuristic is fiddly enough that
/// having TWO implementations of it would guarantee they drift.
pub fn detect_agent_executables(wsl: bool, distro: Option<String>) -> AgentExecutables {
    let key = format!("{}:{}", wsl, distro.as_deref().unwrap_or(""));
    if let Ok(cache) = agent_exe_cache().lock() {
        if let Some(hit) = cache.get(&key) {
            return hit.clone();
        }
    }
    let (found, cacheable) = if wsl {
        // A FAILED probe is never cached. Caching it would poison the entry for
        // the process lifetime: one cold-distro timeout on the first launch after
        // boot and the placeholder shows nothing for the rest of the session,
        // with no user-reachable way to refresh short of restarting the app.
        match probe_in_distro(distro.as_deref()) {
            Some(found) => (found, true),
            None => (AgentExecutables::default(), false),
        }
    } else {
        (probe_on_host(), true)
    };
    if cacheable {
        if let Ok(mut cache) = agent_exe_cache().lock() {
            cache.insert(key, found.clone());
        }
    }
    found
}

/// Drop every cached detection. Called when the shell preference changes, so a
/// value detected under the previous shell is never presented as current.
pub fn clear_agent_executable_cache() {
    if let Ok(mut cache) = agent_exe_cache().lock() {
        cache.clear();
    }
}

/// Host probe: the seeded `PATH`, which already includes the recovery dirs.
fn probe_on_host() -> AgentExecutables {
    let find = |p: &str| which_on_path(p).map(|path| path.to_string_lossy().into_owned());
    AgentExecutables {
        claude: find("claude"),
        copilot: find("copilot"),
        node: find("node"),
    }
}

/// The probe script. Emits one `name<TAB>path` line per program, with an EMPTY
/// path when absent.
///
/// Labelling each line matters: a bare `command -v a; command -v b` prints only
/// the hits, so with one missing you can only tell WHICH by assuming the order
/// held — and `command -v` is free to print nothing at all. Labels make the
/// parse unambiguous and let it ignore profile noise on the same stream.
///
/// `|| true` keeps a miss from ending the script under a shell that inherits
/// `set -e` from a profile.
fn probe_script() -> String {
    let names = PROBED_PROGRAMS.join(" ");
    format!(
        "for p in {names}; do printf '{SENTINEL_START}%s\t%s{SENTINEL_END}\n' \"$p\" \"$(command -v \"$p\" 2>/dev/null || true)\"; done"
    )
}

/// Run the probe inside the distro through a LOGIN shell.
///
/// `-lc` is not incidental: the agent CLIs install into `~/.local/bin`, which is
/// on `PATH` only once the login profile has been sourced. A non-login probe
/// would report "not installed" for a perfectly working install.
///
/// Bounded by `SHELL_TIMEOUT`, because probing a distro that is not running
/// makes `wsl.exe` boot it first — exactly the blocking case that bound exists
/// for. `None` on any failure; the caller degrades to "nothing detected".
fn probe_in_distro(distro: Option<&str>) -> Option<AgentExecutables> {
    let mut cmd = std::process::Command::new("wsl.exe");
    if let Some(d) = distro {
        if !d.is_empty() {
            cmd.args(["-d", d]);
        }
    }
    cmd.args(["--", "sh", "-lc", &probe_script()]);

    let mut child = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

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
    Some(parse_agent_probe(&out))
}

/// PURE: parse the probe's labelled output into `AgentExecutables`.
///
/// Reads only sentinel-framed `name<TAB>path` records, so anything else a login
/// profile prints to stdout (banners, motd, `fortune`) is ignored rather than
/// mistaken for a path. An empty or whitespace-only path means "not found".
pub fn parse_agent_probe(output: &str) -> AgentExecutables {
    let mut found = AgentExecutables::default();
    for raw in output.split(SENTINEL_START).skip(1) {
        let Some(record) = raw.split(SENTINEL_END).next() else {
            continue;
        };
        let Some((name, path)) = record.split_once('\t') else {
            continue;
        };
        let path = path.trim();
        if path.is_empty() {
            continue;
        }
        let slot = match name.trim() {
            "claude" => &mut found.claude,
            "copilot" => &mut found.copilot,
            "node" => &mut found.node,
            _ => continue,
        };
        *slot = Some(path.to_string());
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- agent-executable probe parsing (`wsl-agent-launch`) ---------------

    fn record(name: &str, path: &str) -> String {
        format!("{SENTINEL_START}{name}\t{path}{SENTINEL_END}\n")
    }

    #[test]
    fn detection_inside_the_distro() {
        // The real shape from the reporting user's machine: both agent CLIs
        // under ~/.local/bin (reachable only via the login profile), and NO
        // node — which is what makes the statusline retention conditional.
        let out = format!(
            "{}{}{}",
            record("claude", "/home/v-patel/.local/bin/claude"),
            record("copilot", "/home/v-patel/.local/bin/copilot"),
            record("node", "")
        );
        let found = parse_agent_probe(&out);
        assert_eq!(
            found.claude.as_deref(),
            Some("/home/v-patel/.local/bin/claude")
        );
        assert_eq!(
            found.copilot.as_deref(),
            Some("/home/v-patel/.local/bin/copilot")
        );
        assert_eq!(found.node, None);
    }

    #[test]
    fn detection_finds_nothing() {
        // Every program absent: an empty result, not an error.
        let out = format!(
            "{}{}{}",
            record("claude", ""),
            record("copilot", ""),
            record("node", "")
        );
        assert_eq!(parse_agent_probe(&out), AgentExecutables::default());
        // And a completely empty stream is equally benign.
        assert_eq!(parse_agent_probe(""), AgentExecutables::default());
    }

    #[test]
    fn probe_parse_ignores_profile_noise() {
        // A login shell may print a motd/banner. Sentinel framing means only
        // real records are read — unframed text is never mistaken for a path.
        let out = format!(
            "Welcome to Ubuntu 24.04 LTS\n* Docs: https://help.ubuntu.com\n{}garbage\t/nope\n{}",
            record("claude", "/usr/local/bin/claude"),
            record("node", "/usr/bin/node")
        );
        let found = parse_agent_probe(&out);
        assert_eq!(found.claude.as_deref(), Some("/usr/local/bin/claude"));
        assert_eq!(found.node.as_deref(), Some("/usr/bin/node"));
        assert_eq!(found.copilot, None);
    }

    #[test]
    fn probe_parse_keeps_a_path_containing_spaces() {
        // Tab-separated precisely so a spaced install dir survives the parse.
        let out = record("claude", "/home/u/my tools/claude");
        assert_eq!(
            parse_agent_probe(&out).claude.as_deref(),
            Some("/home/u/my tools/claude")
        );
    }

    #[test]
    fn probe_parse_trims_trailing_whitespace() {
        let out = record("claude", "  /usr/bin/claude  ");
        assert_eq!(
            parse_agent_probe(&out).claude.as_deref(),
            Some("/usr/bin/claude")
        );
        // Whitespace-only is "not found", not a path made of spaces.
        assert_eq!(parse_agent_probe(&record("node", "   ")).node, None);
    }

    #[test]
    #[cfg(not(windows))]
    fn the_probe_does_not_return() {
        // The degradation contract: when the probe cannot complete — no wsl.exe
        // here, and on a real box a distro that never finishes booting within
        // SHELL_TIMEOUT — detection yields NOTHING rather than hanging or
        // erroring, and the caller falls through to the bare program name.
        // Guarded off Windows, where a real WSL install would actually answer.
        let found = detect_agent_executables(true, Some("no-such-distro".to_string()));
        assert_eq!(found, AgentExecutables::default());
    }

    #[test]
    fn detection_is_cached_per_target_and_clearable() {
        // Keyed by target, NOT process-lifetime: the paths are a function of the
        // shell preference, so a OnceLock would keep showing a Linux path after
        // the user switched back to a host shell.
        clear_agent_executable_cache();
        let host = detect_agent_executables(false, None);
        assert_eq!(host, detect_agent_executables(false, None), "cache hit differs");
        clear_agent_executable_cache();
        assert_eq!(host, detect_agent_executables(false, None), "recompute differs");
    }

    #[test]
    fn probe_script_labels_every_probed_program() {
        let script = probe_script();
        for p in PROBED_PROGRAMS {
            assert!(script.contains(p), "{p} missing from probe script");
        }
        // `node` specifically: the statusline depends on it inside the distro.
        assert!(script.contains("node"));
        assert!(script.contains("command -v"));
    }

    #[test]
    fn merge_dedupes_preserving_first_seen_order() {
        let merged = merge_path_sources_with(&["/a:/b", "/b:/c", "/a:/d"], ':');
        assert_eq!(merged, "/a:/b:/c:/d");
    }

    #[test]
    fn merge_drops_empty_segments() {
        // Leading/trailing/double colons must not yield empty PATH entries (an
        // empty entry means "current dir" to the shell — a security/footgun).
        let merged = merge_path_sources_with(&[":/a::", "", "/b:"], ':');
        assert_eq!(merged, "/a:/b");
    }

    #[test]
    fn merge_recovers_local_bin_from_sparse_process_path() {
        // The bug: a sparse Finder PATH lacks ~/.local/bin where claude lives.
        // The well-known union must restore it (and Homebrew) regardless.
        let sparse = "/usr/bin:/bin:/usr/sbin:/sbin";
        let well_known = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
        let merged = merge_path_sources_with(&[sparse, "/Users/x/.local/bin", well_known], ':');
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
                "/Users/x/.npm-global/bin",
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
    // Asserts Unix-specific directories against the LIVE host PATH, so it is
    // meaningful only on Unix. Without this gate it fails on Windows (a
    // `;`-joined PATH split on `:` never contains `/usr/bin`) — an assertion
    // about the host masquerading as an assertion about the code.
    #[cfg(unix)]
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

    /// The Windows safety net must actually be able to resolve BOTH shells
    /// `default_shell` can return — otherwise its "always present"
    /// `powershell.exe` fallback is unreachable from a sparse PATH.
    #[test]
    fn windows_safety_net_contains_both_powershells() {
        let path = compose_path("", "", r"C:\Users\dev", true);
        let dirs: Vec<&str> = path.split(';').collect();
        assert!(
            dirs.contains(&r"C:\Windows\System32\WindowsPowerShell\v1.0"),
            "powershell.exe dir missing: {path}"
        );
        assert!(
            dirs.contains(&r"C:\Program Files\PowerShell\7"),
            "pwsh dir missing: {path}"
        );
    }
}
