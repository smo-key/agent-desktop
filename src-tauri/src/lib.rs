pub mod pty;
pub mod task;
pub mod usage;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use pty::{PaneId, PtyEvent, PtyManager, SpawnConfig};
use task::{ForeignSession, ForeignWatcher, FOREIGN_EVENT};
use usage::{Snapshot, SnapshotWatcher, SNAPSHOT_EVENT};

/// Basename of the persisted layout file under the app-data directory.
const LAYOUT_FILE: &str = "layout.json";

/// The statusline wrapper source, version-controlled under `src-tauri/resources`
/// and baked into the binary. Installed verbatim to `<app_data_dir>/bin/` on
/// setup so a session can be launched with
/// `claude --settings '{"statusLine":{"command":"<that-path>"}}'`. It is authored
/// as CommonJS so it runs standalone (no sibling package.json) under the `node`
/// shebang regardless of the host project's module type.
const STATUSLINE_WRAPPER_SRC: &str = include_str!("../resources/statusline-wrapper.cjs");

/// Subdir (under app-data) holding the installed wrapper executable.
const BIN_DIR: &str = "bin";
/// Installed wrapper basename. Kept as `.js` (the name the spec/`--settings`
/// command reference); standalone with no sibling package.json `node` treats a
/// `.js` file as CommonJS, so the CommonJS source runs correctly.
const WRAPPER_FILE: &str = "statusline-wrapper.js";
/// Subdir (under app-data) the wrapper writes per-pane snapshots into and the
/// `SnapshotWatcher` watches.
const SNAPSHOT_DIR: &str = "snapshots";

/// Absolute paths the frontend needs to launch sessions wired into the usage
/// dashboard. Serialized camelCase for the JS side.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePaths {
    /// Absolute path to the installed `statusline-wrapper.js` — goes verbatim
    /// into the `--settings` `statusLine.command` of every spawned session.
    pub wrapper_path: String,
    /// Absolute path to the snapshots dir — passed as `AGENT_DESKTOP_SNAPSHOT_DIR`
    /// in the spawned process env and watched by the `SnapshotWatcher`.
    pub snapshot_dir: String,
}

/// Spawn a PTY-backed process for a pane. Output is streamed to the frontend
/// over the per-pane `on_event` channel as `PtyEvent`s; returns the new pane id.
///
/// `env` is an OPTIONAL list of extra `(key, value)` environment entries merged
/// into the child env after the seeded base (caller wins). It defaults to empty
/// when the frontend omits it, so shell panes spawn with no extra env; `claude`
/// panes pass `AGENT_DESKTOP_PANE`/`AGENT_DESKTOP_SNAPSHOT_DIR` here.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn pty_spawn(
    manager: State<'_, Arc<PtyManager>>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env: Option<Vec<(String, String)>>,
    on_event: Channel<PtyEvent>,
) -> Result<PaneId, String> {
    let cfg = SpawnConfig {
        program,
        args,
        cwd,
        cols,
        rows,
        env: env.unwrap_or_default(),
    };
    // Bridge the Tauri Channel into the manager's generic sink. A send error
    // (channel closed) maps to Err(()), which stops the read loop.
    manager.spawn_with_sink(cfg, move |ev| on_event.send(ev).map_err(|_| ()))
}

/// Forward raw input bytes from xterm to a pane's PTY writer.
#[tauri::command]
fn pty_write(manager: State<'_, Arc<PtyManager>>, id: PaneId, data: Vec<u8>) -> Result<(), String> {
    manager.write(id, data)
}

/// Resize a pane's PTY (delivers SIGWINCH to the child).
#[tauri::command]
fn pty_resize(
    manager: State<'_, Arc<PtyManager>>,
    id: PaneId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(id, cols, rows)
}

/// Kill a pane's child process (and let the read loop reap it on EOF).
#[tauri::command]
fn pty_kill(manager: State<'_, Arc<PtyManager>>, id: PaneId) -> Result<(), String> {
    manager.kill(id)
}

/// Resolve the absolute path to the layout file, creating the app-data dir if
/// needed. Errors are stringified for the frontend (which falls back to a fresh
/// workspace on any failure).
fn layout_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;
    Ok(dir.join(LAYOUT_FILE))
}

/// Load the persisted layout JSON, or `None` when no layout file exists yet.
/// A read error (other than not-found) is surfaced so the frontend can fall
/// back to a fresh workspace rather than crash.
#[tauri::command]
fn layout_load(app: AppHandle) -> Result<Option<String>, String> {
    let path = layout_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {path:?}: {e}")),
    }
}

/// Atomically persist the layout JSON: write a sibling temp file then rename it
/// over the target, so a crash mid-write never leaves a truncated/corrupt
/// layout file (the frontend always reads either the old or the new whole file).
#[tauri::command]
fn layout_save(app: AppHandle, json: String) -> Result<(), String> {
    let path = layout_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| format!("write {tmp:?}: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))?;
    Ok(())
}

/// Resolve `<app_data_dir>`, creating it if needed.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;
    Ok(dir)
}

/// Install the baked statusline wrapper to `<app_data_dir>/bin/statusline-wrapper.js`
/// (mode 0755 on Unix) and ensure `<app_data_dir>/snapshots/` exists. Returns the
/// absolute wrapper path + snapshot dir. Idempotent: the wrapper is rewritten on
/// every call so an app update ships the latest source. The write is atomic
/// (sibling `.tmp` + rename) so a concurrent launch never reads a half-written
/// wrapper.
fn install_usage_assets(app: &AppHandle) -> Result<UsagePaths, String> {
    let base = app_data_dir(app)?;
    install_usage_assets_in(&base)
}

/// Filesystem half of [`install_usage_assets`], factored out so it can be tested
/// against a `tempdir` base without constructing a Tauri `AppHandle`. Writes the
/// wrapper to `<base>/bin/statusline-wrapper.js` (atomic, mode 0755 on Unix) and
/// ensures `<base>/snapshots/` exists, returning both absolute paths.
pub fn install_usage_assets_in(base: &std::path::Path) -> Result<UsagePaths, String> {
    let bin = base.join(BIN_DIR);
    fs::create_dir_all(&bin).map_err(|e| format!("create_dir_all {bin:?}: {e}"))?;

    let wrapper = bin.join(WRAPPER_FILE);
    let tmp = wrapper.with_extension("js.tmp");
    fs::write(&tmp, STATUSLINE_WRAPPER_SRC).map_err(|e| format!("write {tmp:?}: {e}"))?;

    // Make the wrapper executable (it runs via its `#!/usr/bin/env node` shebang).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod {tmp:?}: {e}"))?;
    }

    fs::rename(&tmp, &wrapper).map_err(|e| format!("rename {tmp:?} -> {wrapper:?}: {e}"))?;

    let snapshots = base.join(SNAPSHOT_DIR);
    fs::create_dir_all(&snapshots).map_err(|e| format!("create_dir_all {snapshots:?}: {e}"))?;

    Ok(UsagePaths {
        wrapper_path: wrapper.to_string_lossy().into_owned(),
        snapshot_dir: snapshots.to_string_lossy().into_owned(),
    })
}

/// Return the absolute wrapper path + snapshot dir for launching sessions wired
/// into the usage dashboard, (re)installing the wrapper and ensuring both
/// directories exist as a side effect.
#[tauri::command]
fn usage_paths(app: AppHandle) -> Result<UsagePaths, String> {
    install_usage_assets(&app)
}

/// Return the current set of per-pane snapshots so the frontend can SEED its
/// store on mount (panes that already have a snapshot render immediately, before
/// any fs event fires). Reads `<app_data_dir>/snapshots/*.json`, skipping any
/// malformed/partial files; a missing dir yields an empty list. Never errors on
/// snapshot content — only on resolving the app-data dir.
#[tauri::command]
fn usage_snapshots(app: AppHandle) -> Result<Vec<Snapshot>, String> {
    let dir = app_data_dir(&app)?.join(SNAPSHOT_DIR);
    Ok(usage::read_all_snapshots(&dir))
}

/// Start the snapshot-directory watcher, emitting each parsed snapshot to the
/// frontend over the `usage://snapshot` event. The returned [`SnapshotWatcher`]
/// is held in Tauri-managed state so it lives for the app's lifetime and is
/// dropped cleanly on exit (its `Drop` stops the watch).
fn start_usage_watcher(app: &AppHandle) -> Result<SnapshotWatcher, String> {
    let dir = app_data_dir(app)?.join(SNAPSHOT_DIR);
    let handle = app.clone();
    usage::start_snapshot_watcher(&dir, move |snap| {
        // Push the parsed snapshot to the frontend. A failed emit (no window
        // yet / closing) is non-fatal — the next render re-emits, and the
        // frontend re-seeds via `usage_snapshots` on mount.
        if let Err(e) = handle.emit(SNAPSHOT_EVENT, &snap) {
            log::warn!("emit {SNAPSHOT_EVENT} failed: {e}");
        }
    })
}

/// The shared app-session exclude-set, held in Tauri-managed state. The frontend
/// keeps it current via the `foreign_sessions` command (passing its app-launched
/// pane session ids); the foreign watcher reads it on every recompute so it never
/// double-counts an app pane as a foreign session.
#[derive(Default)]
struct AppSessionsState(task::AppSessions);

/// Return the current set of FOREIGN Claude sessions (running outside the app),
/// after updating the shared exclude-set to `app_session_ids` (the session ids of
/// the caller's app-launched panes). Watches the live `~/.claude/tasks/` +
/// `$TMPDIR/claude-ctx-*.json`; the returned list EXCLUDES every id in
/// `app_session_ids` so the app does not double-count its own panes. Used both to
/// SEED the frontend on mount and to push the exclude-set whenever the app's pane
/// set changes (subsequent live updates arrive over the `usage://foreign` event).
/// A missing tasks dir yields an empty list, never an error.
#[tauri::command]
fn foreign_sessions(
    state: State<'_, AppSessionsState>,
    app_session_ids: Vec<String>,
) -> Result<Vec<ForeignSession>, String> {
    // Update the shared exclude-set so the watcher's next recompute uses it too.
    {
        let mut guard = state.0.lock().map_err(|_| "app-sessions lock poisoned")?;
        *guard = app_session_ids.into_iter().collect();
    }
    let tasks_base =
        task::default_tasks_base().ok_or("HOME unset; cannot locate ~/.claude/tasks")?;
    let tmp_dir = task::default_tmp_dir();
    let app = state.0.lock().map_err(|_| "app-sessions lock poisoned")?;
    Ok(task::compute_foreign_sessions(&tasks_base, &tmp_dir, &app))
}

/// Start the foreign-session watcher over `~/.claude/tasks/` + `$TMPDIR`,
/// emitting the (filtered) foreign list to the frontend over `usage://foreign`.
/// Shares `app_sessions` with the `foreign_sessions` command so the exclude-set is
/// always current. The returned [`ForeignWatcher`] is held in managed state for
/// the app's lifetime and dropped cleanly on exit.
fn start_foreign_watcher(
    app: &AppHandle,
    app_sessions: task::AppSessions,
) -> Result<ForeignWatcher, String> {
    let tasks_base =
        task::default_tasks_base().ok_or("HOME unset; cannot locate ~/.claude/tasks")?;
    let tmp_dir = task::default_tmp_dir();
    let handle = app.clone();
    task::start_foreign_watcher(&tasks_base, &tmp_dir, app_sessions, move |list| {
        if let Err(e) = handle.emit(FOREIGN_EVENT, &list) {
            log::warn!("emit {FOREIGN_EVENT} failed: {e}");
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Install the statusline wrapper and ensure the snapshots dir exists
            // up front, so sessions can be launched into the dashboard without a
            // first-launch race. Failure is logged but non-fatal — `usage_paths`
            // retries on demand.
            if let Err(e) = install_usage_assets(app.handle()) {
                log::warn!("install_usage_assets failed: {e}");
            }
            // Start watching the snapshots dir and pushing each parsed snapshot
            // to the frontend over `usage://snapshot`. The watcher is held in
            // managed state so it lives for the app's lifetime and is dropped
            // cleanly on exit. Failure is logged but non-fatal — the frontend
            // still seeds the current set via `usage_snapshots` on mount; it
            // simply won't receive live pushes.
            match start_usage_watcher(app.handle()) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!("start_usage_watcher failed: {e}"),
            }
            // Start the foreign-session watcher over ~/.claude/tasks/ + $TMPDIR,
            // sharing the app-session exclude-set with the `foreign_sessions`
            // command so it never double-counts the app's own panes. Held in
            // managed state for the app's lifetime; failure is logged but
            // non-fatal — the frontend still seeds via `foreign_sessions` and
            // simply won't receive live `usage://foreign` pushes.
            let app_sessions = app.state::<AppSessionsState>().0.clone();
            match start_foreign_watcher(app.handle(), app_sessions) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!("start_foreign_watcher failed: {e}"),
            }
            Ok(())
        })
        .manage(Arc::new(PtyManager::new()))
        .manage(AppSessionsState::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            layout_load,
            layout_save,
            usage_paths,
            usage_snapshots,
            foreign_sessions
        ])
        .on_window_event(|window, event| {
            // Kill + reap every pane on app quit so no zombie/orphan processes
            // remain. The LAYOUT flush is coordinated on the frontend: it listens
            // for `tauri://close-requested`, writes the latest state via
            // `layout_save`, then closes the window — so by the time this handler
            // runs (and kills the PTYs) the layout file is already persisted.
            if let WindowEvent::CloseRequested { .. } = event {
                let manager = window.state::<Arc<PtyManager>>();
                manager.kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A throwaway dir under the system temp dir, removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-{tag}-{nanos}"));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn install_writes_executable_wrapper_and_creates_snapshot_dir() {
        let tmp = TempDir::new("install");
        let paths = install_usage_assets_in(tmp.path()).unwrap();

        // Both returned paths are absolute and exist.
        let wrapper = PathBuf::from(&paths.wrapper_path);
        let snapshots = PathBuf::from(&paths.snapshot_dir);
        assert!(wrapper.is_absolute(), "wrapper path must be absolute");
        assert!(snapshots.is_absolute(), "snapshot dir must be absolute");
        assert!(wrapper.is_file(), "wrapper file must exist");
        assert!(snapshots.is_dir(), "snapshot dir must exist");

        // Installed under <base>/bin/statusline-wrapper.js and is the baked source.
        assert_eq!(wrapper, tmp.path().join(BIN_DIR).join(WRAPPER_FILE));
        assert_eq!(snapshots, tmp.path().join(SNAPSHOT_DIR));
        let installed = fs::read_to_string(&wrapper).unwrap();
        assert_eq!(installed, STATUSLINE_WRAPPER_SRC);
        assert!(
            installed.starts_with("#!/usr/bin/env node"),
            "wrapper keeps its node shebang"
        );

        // Executable bit set (0755) on Unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&wrapper).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755, "wrapper must be mode 0755");
        }

        // No leftover temp file from the atomic write.
        assert!(!tmp
            .path()
            .join(BIN_DIR)
            .join("statusline-wrapper.js.tmp")
            .exists());
    }

    #[test]
    fn install_is_idempotent_and_rewrites_wrapper() {
        let tmp = TempDir::new("idempotent");
        let first = install_usage_assets_in(tmp.path()).unwrap();

        // Clobber the installed wrapper, then re-install: it is rewritten verbatim.
        fs::write(&first.wrapper_path, "stale contents").unwrap();
        let second = install_usage_assets_in(tmp.path()).unwrap();

        assert_eq!(first.wrapper_path, second.wrapper_path);
        assert_eq!(first.snapshot_dir, second.snapshot_dir);
        assert_eq!(
            fs::read_to_string(&second.wrapper_path).unwrap(),
            STATUSLINE_WRAPPER_SRC
        );
    }
}
