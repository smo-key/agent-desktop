pub mod pty;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, WindowEvent};

use pty::{PaneId, PtyEvent, PtyManager, SpawnConfig};

/// Basename of the persisted layout file under the app-data directory.
const LAYOUT_FILE: &str = "layout.json";

/// Spawn a PTY-backed process for a pane. Output is streamed to the frontend
/// over the per-pane `on_event` channel as `PtyEvent`s; returns the new pane id.
#[tauri::command]
fn pty_spawn(
    manager: State<'_, Arc<PtyManager>>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<PaneId, String> {
    let cfg = SpawnConfig {
        program,
        args,
        cwd,
        cols,
        rows,
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
            Ok(())
        })
        .manage(Arc::new(PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            layout_load,
            layout_save
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
