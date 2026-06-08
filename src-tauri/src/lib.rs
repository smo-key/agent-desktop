pub mod activity;
pub mod claude_title;
pub mod events;
pub mod git;
pub mod models;
pub mod orchestration;
pub mod polish;
pub mod project_store;
pub mod pty;
pub mod specialists;
pub mod subagents;
pub mod task;
pub mod transcribe;
pub mod usage;
pub mod vad;
pub mod voice_activation;
pub mod whisper_server;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use activity::{Activity, PaneRef};
use events::{AgentEvent, EventState, EVENT_EVENT};
use pty::{PaneId, PtyEvent, PtyManager, SpawnConfig};
use subagents::{SessionRef, Subagent, SubagentsWatcher, SUBAGENTS_EVENT};
use usage::{Snapshot, SnapshotWatcher, SNAPSHOT_EVENT};

use std::collections::HashMap;

/// Basename of the persisted layout file under the app-data directory.
const LAYOUT_FILE: &str = "layout.json";

/// Basename of the persisted recent-folders file (sibling of `layout.json`).
const RECENTS_FILE: &str = "recents.json";

/// Basename of the persisted projects file (sibling of `layout.json`).
const PROJECTS_FILE: &str = "projects.json";

/// Basename of the persisted user-settings file (sibling of `layout.json`),
/// holding the open-with preferences (which app opens code/html/other files).
const SETTINGS_FILE: &str = "settings.json";

/// Basename of the persisted project-terminals file (sibling of `layout.json`),
/// holding each project's user-created terminal definitions (the Terminals panel).
const TERMINALS_FILE: &str = "terminals.json";

/// Basename of the persisted project-tasks file (sibling of `layout.json`),
/// holding each project's user-created task definitions (the Tasks panel).
const TASKS_FILE: &str = "tasks.json";

/// The statusline wrapper source, version-controlled under `src-tauri/resources`
/// and baked into the binary. Installed verbatim to `<app_data_dir>/bin/` on
/// setup so a session can be launched with
/// `claude --settings '{"statusLine":{"command":"<that-path>"}}'`. It is authored
/// as CommonJS so it runs standalone (no sibling package.json) under the `node`
/// shebang regardless of the host project's module type.
const STATUSLINE_WRAPPER_SRC: &str = include_str!("../resources/statusline-wrapper.cjs");

/// The baked event-hook source (installed beside the wrapper). It is wired into
/// the FULL hook lifecycle event set and delivers each normalized event over the
/// app-hosted Unix socket, feeding the overview's event-sourced status + per-tool
/// timeline (see `events.rs`).
const EVENT_HOOK_SRC: &str = include_str!("../resources/event-hook.cjs");

/// The baked orchestration MCP ADAPTER source (installed beside the wrapper). It is
/// the dependency-free stdio MCP server attached to a launched COORDINATOR session
/// (`--mcp-config`); it forwards each toolkit tool call over the Rust control socket
/// to the frontend executor. Authored as CommonJS so it runs standalone under the
/// `node` shebang. See `resources/orchestration-mcp.cjs`.
const ORCHESTRATION_MCP_SRC: &str = include_str!("../resources/orchestration-mcp.cjs");

/// Subdir (under app-data) holding the installed wrapper executable.
const BIN_DIR: &str = "bin";
/// Installed wrapper basename. Kept as `.js` (the name the spec/`--settings`
/// command reference); standalone with no sibling package.json `node` treats a
/// `.js` file as CommonJS, so the CommonJS source runs correctly.
const WRAPPER_FILE: &str = "statusline-wrapper.js";
/// Installed event-hook basename (a standalone `.js`, run via its shebang).
const EVENT_HOOK_FILE: &str = "event-hook.js";
/// Installed orchestration MCP adapter basename (a standalone `.js`, run via `node`
/// in the coordinator's `--mcp-config` server).
const ORCHESTRATION_MCP_FILE: &str = "orchestration-mcp.js";
/// Subdir (under app-data) the wrapper writes per-pane snapshots into and the
/// `SnapshotWatcher` watches.
const SNAPSHOT_DIR: &str = "snapshots";
/// Subdir (under app-data) holding the durable per-session event logs the event
/// pipeline appends to (`events/<sessionId>.jsonl`).
const EVENTS_DIR: &str = "events";
/// Basename (under app-data) of the Unix-domain socket the event hook delivers to.
const SOCKET_FILE: &str = "events.sock";
/// Basename (under app-data) of the orchestration CONTROL socket — the bundled MCP
/// toolkit adapter connects here to round-trip toolkit ops through the frontend
/// executor (see `orchestration.rs`). Sibling of `events.sock`; its absolute path
/// is conveyed to a launched coordinator session via `orchestration::CONTROL_SOCKET_ENV`.
const CONTROL_SOCKET_FILE: &str = "control.sock";

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
    /// Absolute path to the installed `event-hook.js` — goes verbatim into the
    /// `--settings` `hooks` config (the full lifecycle event set) of every spawned
    /// session so the overview's status + per-tool timeline are event-sourced.
    pub event_hook_path: String,
    /// Absolute path to the app-hosted Unix socket the event hook delivers to —
    /// passed as `AGENT_DESKTOP_SOCKET_PATH` in the spawned process env.
    pub socket_path: String,
    /// Absolute path to the installed orchestration MCP adapter — `node <this>` is
    /// the coordinator launch's `--mcp-config` server command (`buildMcpToolkitConfig`).
    pub adapter_path: String,
    /// Absolute path to the Rust orchestration CONTROL socket (sibling of
    /// `socket_path`) — goes into the coordinator's `--mcp-config` server env as
    /// `AGENT_DESKTOP_CONTROL_SOCKET` so the adapter can reach the executor.
    pub control_socket_path: String,
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

/// Open `path` in the Cursor editor (macOS `open -a Cursor <path>`). The frontend
/// resolves a relative filename against the agent's cwd before calling, so `path`
/// is absolute. Best-effort: spawns and returns; a launch failure is surfaced as a
/// string the frontend can log/ignore (never blocks the UI).
#[tauri::command]
fn open_in_editor(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-a", "Cursor", &path])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open -a Cursor {path}: {e}"))
}

/// Resolve a terminal `token` to an existing absolute path, cwd-aware. `~`/`~/...`
/// expand against `$HOME`; absolute tokens pass through; everything else is joined
/// against the pane's `cwd`. `fs::canonicalize` both validates existence (it errors
/// if the path is missing) and yields the absolute, symlink-resolved path. Returns
/// `Ok(None)` for anything that doesn't map to an existing path (no `cwd` for a
/// relative token, `~user` form, missing `$HOME`, or non-existent path) so the
/// frontend simply declines to linkify — only real paths get an affordance.
#[tauri::command]
fn resolve_path(cwd: Option<String>, token: String) -> Result<Option<String>, String> {
    let token = token.trim();
    if token.is_empty() {
        return Ok(None);
    }
    let candidate: PathBuf = if let Some(rest) = token.strip_prefix('~') {
        let Ok(home) = std::env::var("HOME") else {
            return Ok(None);
        };
        if rest.is_empty() {
            PathBuf::from(home)
        } else if let Some(rest) = rest.strip_prefix('/') {
            PathBuf::from(home).join(rest)
        } else {
            // `~user` form is not supported.
            return Ok(None);
        }
    } else {
        let p = PathBuf::from(token);
        if p.is_absolute() {
            p
        } else {
            match cwd {
                Some(c) => PathBuf::from(c).join(p),
                None => return Ok(None),
            }
        }
    };
    Ok(fs::canonicalize(&candidate)
        .ok()
        .map(|abs| abs.to_string_lossy().into_owned()))
}

/// Open `path` in an application. With `app` set, launches that specific app
/// (macOS `open -a <app> <path>`, e.g. "Brave Browser", "Cursor"); with `app`
/// `None`/empty, opens in the OS default handler (`open <path>` — registered app
/// for files, Finder for directories). The frontend picks `app` from the user's
/// open-with preferences. Mirrors `open_in_editor` — best-effort spawn-and-return;
/// a launch failure is surfaced as a string the frontend logs/ignores.
#[tauri::command]
fn open_path(path: String, app: Option<String>) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    match app.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        Some(app) => {
            cmd.args(["-a", app, &path]);
        }
        None => {
            cmd.arg(&path);
        }
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("open {path} (app {app:?}): {e}"))
}

/// Clean a raw model completion into a session-title string: drop any Qwen3
/// `<think>…</think>` reasoning block that slipped into the content, take the first
/// non-empty line, strip wrapping quotes / trailing periods, and clip to 60 chars.
/// PURE so the post-processing is unit-tested apart from the model call.
fn clean_title(raw: &str) -> String {
    let body = strip_think_blocks(raw);
    let title = body
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .trim_matches(|c| c == '"' || c == '\'' || c == '.')
        .trim();
    title.chars().take(60).collect()
}

/// Byte index of the first ASCII-case-insensitive occurrence of `needle` in
/// `haystack`, as an offset valid for slicing `haystack` itself. `needle` MUST be
/// ASCII (our literal `<think>` tags are). Searching byte windows on the ORIGINAL
/// string keeps offsets aligned — unlike searching a `to_lowercase()` copy, whose
/// offsets can drift when case-folding changes the byte length (e.g. `İ` lowercases
/// to two code points), which would risk an out-of-bounds / non-boundary panic or
/// silent corruption. An all-ASCII match can only start on a char boundary (UTF-8
/// multi-byte sequences never contain ASCII bytes), so the index is always valid.
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    let (hay, ndl) = (haystack.as_bytes(), needle.as_bytes());
    if ndl.is_empty() || hay.len() < ndl.len() {
        return None;
    }
    (0..=hay.len() - ndl.len()).find(|&i| hay[i..i + ndl.len()].eq_ignore_ascii_case(ndl))
}

/// Remove every `<think>…</think>` span (case-insensitive) from `s`. Qwen3 is a
/// reasoning model; with thinking disabled the content is bare, but if a stray
/// reasoning block leaks through it must not corrupt a 6-word title. An unterminated
/// `<think>` drops the remainder. Offsets come from [`find_ascii_ci`] (valid for the
/// original string), so multi-byte content around a tag never panics or corrupts.
fn strip_think_blocks(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    loop {
        let Some(start) = find_ascii_ci(rest, "<think>") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after_open = &rest[start + "<think>".len()..];
        match find_ascii_ci(after_open, "</think>") {
            Some(end_rel) => rest = &after_open[end_rel + "</think>".len()..],
            // Unterminated `<think>`: everything after it is reasoning; drop it.
            None => break,
        }
    }
    out
}

/// Generate a short session FOCUS title from the user's messages. The PRIMARY path
/// is the LOCAL model (the `llama-server` sidecar loading the Qwen3 polish model —
/// see `polish.rs`): locate the session transcript, extract the user's prose
/// messages, and ask the local model for a <=6-word title (e.g. "SKIPA-45: Fix
/// Feature"). Returns `None` when the user has sent nothing yet.
///
/// When the on-device path fails for ANY reason (model absent, sidecar won't start,
/// HTTP error, timeout) AND `cloud_fallback` is set (the opt-in `titles.cloudFallback`
/// setting), regenerate the title with the `claude` CLI (`claude -p --model haiku` —
/// see `claude_title.rs`), reusing the same prompt + `clean_title` so the result is
/// identical in shape. With `cloud_fallback` off the on-device failure returns `Err`
/// and the frontend keeps the previous title (the original on-device-only behavior).
/// The frontend gates calls on the `user_hash` so a title is regenerated only when
/// the user's messages actually change.
///
/// `async` runs this off the main/UI thread: the model call can take a moment, and
/// the sidecar may need a lazy start on the first request; the UI stays responsive
/// while the title resolves in the background.
#[tauri::command]
async fn session_focus(
    app: AppHandle,
    state: State<'_, Arc<polish::LlamaServer>>,
    session_id: String,
    cwd: Option<String>,
    cloud_fallback: bool,
) -> Result<Option<String>, String> {
    let projects_base =
        activity::projects_base().ok_or("HOME unset; cannot locate ~/.claude/projects")?;
    let pane = PaneRef {
        pane_id: String::new(),
        session_id: Some(session_id),
        cwd,
    };
    let Some(transcript) = activity::find_transcript(&projects_base, &pane) else {
        return Ok(None);
    };
    let msgs = activity::user_messages(&transcript);
    if msgs.is_empty() {
        return Ok(None);
    }
    // Bound the prompt to fit the local model's modest context window (the sidecar
    // runs with a 4096-token context): the last 20 user messages, each clipped.
    let joined: String = msgs
        .iter()
        .rev()
        .take(20)
        .rev()
        .map(|m| {
            let one = m.split_whitespace().collect::<Vec<_>>().join(" ");
            one.chars().take(200).collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n- ");
    let joined = format!("Messages:\n- {joined}");

    // Run the title completion through the shared local-model path (lazy-starts the
    // sidecar). The model id is the registry id; llama-server ignores it for routing.
    let body = polish::build_title_body(&joined, models::POLISH.id);
    let raw = match polish::chat_complete(&app, &state, body).await {
        Ok(raw) => raw,
        Err(on_device_err) => {
            // On-device unavailable. Fall back to the cloud (claude -p haiku) ONLY
            // when the user opted in; otherwise keep the previous title (Err).
            if !cloud_fallback {
                return Err(on_device_err);
            }
            claude_title::claude_title(&joined).await.map_err(|cloud_err| {
                format!(
                    "on-device title failed ({on_device_err}); cloud fallback failed ({cloud_err})"
                )
            })?
        }
    };
    let title = clean_title(&raw);
    Ok((!title.is_empty()).then_some(title))
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

/// Resolve the absolute path to an app-data file named `file`, creating the
/// app-data dir if needed. Errors are stringified for the frontend (which falls
/// back gracefully on any failure).
fn app_data_file(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;
    Ok(dir.join(file))
}

/// Read an app-data JSON file, or `None` when it does not exist yet. A read
/// error (other than not-found) is surfaced so the frontend can fall back rather
/// than crash.
fn read_app_data_json(app: &AppHandle, file: &str) -> Result<Option<String>, String> {
    let path = app_data_file(app, file)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {path:?}: {e}")),
    }
}

/// Atomically write `json` to an app-data file: write a sibling temp file then
/// rename it over the target, so a crash mid-write never leaves a truncated file
/// (a reader always sees either the old or the new whole file).
fn write_app_data_json(app: &AppHandle, file: &str, json: &str) -> Result<(), String> {
    let path = app_data_file(app, file)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| format!("write {tmp:?}: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))?;
    Ok(())
}

/// Load the persisted layout JSON, or `None` when no layout file exists yet.
/// A read error (other than not-found) is surfaced so the frontend can fall
/// back to a fresh workspace rather than crash.
#[tauri::command]
fn layout_load(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_json(&app, LAYOUT_FILE)
}

/// Atomically persist the layout JSON (see [`write_app_data_json`]).
#[tauri::command]
fn layout_save(app: AppHandle, json: String) -> Result<(), String> {
    write_app_data_json(&app, LAYOUT_FILE, &json)
}

/// Load the persisted recent-folders JSON (sibling `recents.json`), or `None`
/// when no file exists yet. The frontend parses tolerantly (empty list on any
/// malformed input), so a read error other than not-found is the only failure
/// surfaced here.
#[tauri::command]
fn recents_load(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_json(&app, RECENTS_FILE)
}

/// Atomically persist the recent-folders JSON (see [`write_app_data_json`]).
#[tauri::command]
fn recents_save(app: AppHandle, json: String) -> Result<(), String> {
    write_app_data_json(&app, RECENTS_FILE, &json)
}

/// Load the persisted projects JSON (sibling `projects.json`), or `None` when no
/// file exists yet. The frontend parses tolerantly (empty list on any malformed
/// input), so a read error other than not-found is the only failure surfaced here.
#[tauri::command]
fn projects_load(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_json(&app, PROJECTS_FILE)
}

/// Atomically persist the projects JSON (see [`write_app_data_json`]).
#[tauri::command]
fn projects_save(app: AppHandle, json: String) -> Result<(), String> {
    write_app_data_json(&app, PROJECTS_FILE, &json)
}

/// Load the persisted user-settings JSON (sibling `settings.json`), or `None` when
/// no file exists yet. The frontend parses tolerantly (falls back to defaults on
/// malformed input), so only a read error other than not-found surfaces here.
#[tauri::command]
fn settings_load(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_json(&app, SETTINGS_FILE)
}

/// Atomically persist the user-settings JSON (see [`write_app_data_json`]).
#[tauri::command]
fn settings_save(app: AppHandle, json: String) -> Result<(), String> {
    write_app_data_json(&app, SETTINGS_FILE, &json)
}

/// Load the persisted project-terminals JSON (sibling `terminals.json`), or `None`
/// when no file exists yet. The frontend parses tolerantly (empty collections on any
/// malformed input), so a read error other than not-found is the only failure here.
#[tauri::command]
fn terminals_load(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_json(&app, TERMINALS_FILE)
}

/// Atomically persist the project-terminals JSON (see [`write_app_data_json`]).
#[tauri::command]
fn terminals_save(app: AppHandle, json: String) -> Result<(), String> {
    write_app_data_json(&app, TERMINALS_FILE, &json)
}

/// Load the persisted project-tasks JSON (sibling `tasks.json`), or `None` when
/// no file exists yet. The frontend parses tolerantly. A one-time migration in the
/// frontend falls back to the legacy `terminals.json` (still read by `terminals_load`)
/// when this file is absent.
#[tauri::command]
fn tasks_load(app: AppHandle) -> Result<Option<String>, String> {
    read_app_data_json(&app, TASKS_FILE)
}

/// Atomically persist the project-tasks JSON (see [`write_app_data_json`]).
#[tauri::command]
fn tasks_save(app: AppHandle, json: String) -> Result<(), String> {
    write_app_data_json(&app, TASKS_FILE, &json)
}

/// Delete the LEGACY user-level `<app_data_dir>/tasks.json`. Deleting an absent
/// file is a NO-OP (not an error). Used to clean up the old user-level store after
/// migrating a project's tasks into its own `.agent-desktop/tasks.json` (see
/// [`project_store`]).
#[tauri::command]
fn tasks_clear(app: AppHandle) -> Result<(), String> {
    let path = app_data_file(&app, TASKS_FILE)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // no-op.
        Err(e) => Err(format!("remove {path:?}: {e}")),
    }
}

/// Delete the LEGACY user-level `<app_data_dir>/terminals.json` (the original name
/// of the user-level task store, still read by `terminals_load` as a migration
/// fallback). Deleting an absent file is a NO-OP. Cleared alongside
/// [`tasks_clear`] after a successful migration so the legacy fallback can never
/// re-fire and resurrect/clobber per-project `.agent-desktop/tasks.json` data.
#[tauri::command]
fn terminals_clear(app: AppHandle) -> Result<(), String> {
    let path = app_data_file(&app, TERMINALS_FILE)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // no-op.
        Err(e) => Err(format!("remove {path:?}: {e}")),
    }
}

/// List a project's SPECIALISTS — the native Claude Code subagent files under
/// `<projectPath>/.claude/agents/*.md`. Returns one `{ name, content }` per `.md`
/// file (raw contents; the frontend parses them via `parseSpecialist`), sorted by
/// name. A missing `.claude/agents/` dir yields an empty list, not an error. See
/// [`specialists::list_specialists`].
#[tauri::command]
fn specialists_list(project_path: String) -> Result<Vec<specialists::SpecialistFile>, String> {
    Ok(specialists::list_specialists(Path::new(&project_path)))
}

/// Read the raw `.md` contents of `<projectPath>/.claude/agents/<name>.md`. Errors
/// when `name` is unsafe or the file can't be read. See
/// [`specialists::read_specialist`].
#[tauri::command]
fn specialists_read(project_path: String, name: String) -> Result<String, String> {
    specialists::read_specialist(Path::new(&project_path), &name)
}

/// Create/overwrite `<projectPath>/.claude/agents/<name>.md` with `content`
/// (atomic temp+rename, creating the dir if needed). Errors when `name` is unsafe.
/// See [`specialists::write_specialist`].
#[tauri::command]
fn specialists_write(project_path: String, name: String, content: String) -> Result<(), String> {
    specialists::write_specialist(Path::new(&project_path), &name, &content)
}

/// Delete `<projectPath>/.claude/agents/<name>.md`. Deleting a nonexistent file is
/// a no-op (not an error). Errors when `name` is unsafe. See
/// [`specialists::delete_specialist`].
#[tauri::command]
fn specialists_delete(project_path: String, name: String) -> Result<(), String> {
    specialists::delete_specialist(Path::new(&project_path), &name)
}

/// Load a project's `.agent-desktop/tasks.json`, or `None` when it does not exist
/// yet. See [`project_store::load_tasks`].
#[tauri::command]
fn project_tasks_load(project_path: String) -> Result<Option<String>, String> {
    project_store::load_tasks(Path::new(&project_path))
}

/// Atomically persist a project's `.agent-desktop/tasks.json` (atomic temp+rename,
/// creating the dir if needed). See [`project_store::save_tasks`].
#[tauri::command]
fn project_tasks_save(project_path: String, json: String) -> Result<(), String> {
    project_store::save_tasks(Path::new(&project_path), &json)
}

/// Load a project's `.agent-desktop/config.json`, or `None` when it does not exist
/// yet. See [`project_store::load_config`].
#[tauri::command]
fn project_config_load(project_path: String) -> Result<Option<String>, String> {
    project_store::load_config(Path::new(&project_path))
}

/// Atomically persist a project's `.agent-desktop/config.json` (atomic temp+rename,
/// creating the dir if needed). See [`project_store::save_config`].
#[tauri::command]
fn project_config_save(project_path: String, json: String) -> Result<(), String> {
    project_store::save_config(Path::new(&project_path), &json)
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

/// Resolve the absolute path to the BUNDLED tiny whisper model, shipped as a
/// Tauri resource at `<resource_dir>/models/ggml-tiny.bin` (see
/// `tauri.conf.json` `bundle.resources`). This is what first-run / OFFLINE
/// transcription uses — it requires no download. Returns the path only if the
/// resource actually exists on disk (it may be absent in a non-bundled `cargo
/// build`/dev run where no resource was provisioned), so callers can fall back to
/// a downloaded model. The resource filename is the single source of truth in
/// `models::TINY`.
#[tauri::command]
fn voice_bundled_model_path(app: AppHandle) -> Result<Option<String>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let path = resource_dir
        .join("models")
        .join(models::tiny_spec().filename);
    if path.is_file() {
        return Ok(Some(path.to_string_lossy().into_owned()));
    }
    // Dev fallback: in `tauri dev`/`cargo run` the bundle.resources are NOT staged
    // into resource_dir, so the bundled model isn't there. Fall back to the
    // provisioned source-tree copy (`src-tauri/models/<file>`, written by
    // scripts/fetch-models.sh) so dictation works while developing. Debug only —
    // a release bundle always ships the real resource.
    #[cfg(debug_assertions)]
    {
        let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join(models::tiny_spec().filename);
        if dev_path.is_file() {
            return Ok(Some(dev_path.to_string_lossy().into_owned()));
        }
    }
    Ok(None)
}

/// Resolve the absolute on-disk path of the FINAL-pass whisper model for the given
/// `tier` (`fast` → small, `accurate` → large-v3-turbo) under
/// `<app_data_dir>/models/<filename>`. Returns the path only when that file is
/// actually present (it is downloaded on first use), so the voice pipeline can
/// fall back to the bundled tiny model (`voice_bundled_model_path`) when the
/// tier's larger model has not been downloaded yet. The filename is the single
/// source of truth in `models::final_model_for`.
#[tauri::command]
fn voice_model_path(app: AppHandle, tier: String) -> Result<Option<String>, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let spec = models::final_model_for(models::Tier::from_str(&tier));
    let path = models::model_path(&base, spec);
    Ok(path.is_file().then(|| path.to_string_lossy().into_owned()))
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

    // Install the baked scripts atomically (sibling `.tmp` + rename, mode 0755).
    let wrapper = install_executable(&bin, WRAPPER_FILE, STATUSLINE_WRAPPER_SRC)?;
    let event_hook = install_executable(&bin, EVENT_HOOK_FILE, EVENT_HOOK_SRC)?;
    let adapter = install_executable(&bin, ORCHESTRATION_MCP_FILE, ORCHESTRATION_MCP_SRC)?;

    let snapshots = base.join(SNAPSHOT_DIR);
    fs::create_dir_all(&snapshots).map_err(|e| format!("create_dir_all {snapshots:?}: {e}"))?;

    // Ensure the durable events dir exists; the socket lives at the app-data root.
    let events = base.join(EVENTS_DIR);
    fs::create_dir_all(&events).map_err(|e| format!("create_dir_all {events:?}: {e}"))?;

    Ok(UsagePaths {
        wrapper_path: wrapper.to_string_lossy().into_owned(),
        snapshot_dir: snapshots.to_string_lossy().into_owned(),
        event_hook_path: event_hook.to_string_lossy().into_owned(),
        socket_path: base.join(SOCKET_FILE).to_string_lossy().into_owned(),
        adapter_path: adapter.to_string_lossy().into_owned(),
        control_socket_path: base.join(CONTROL_SOCKET_FILE).to_string_lossy().into_owned(),
    })
}

/// Write a baked script to `<bin>/<file>` executably (mode 0755 on Unix) via a
/// unique sibling `.tmp` + atomic rename, so a concurrent launch never reads a
/// half-written file. Returns the installed path. Idempotent (rewritten each call,
/// so an app update ships the latest source).
fn install_executable(
    bin: &std::path::Path,
    file: &str,
    src: &str,
) -> Result<std::path::PathBuf, String> {
    let dest = bin.join(file);
    // Unique per-call tmp name (pid + a nanosecond timestamp) so two concurrent
    // installs (e.g. setup + a `usage_paths` call) never collide before rename.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = bin.join(format!("{file}.{}.{nanos}.tmp", std::process::id()));
    fs::write(&tmp, src).map_err(|e| format!("write {tmp:?}: {e}"))?;

    // Make it executable (it runs via its `#!/usr/bin/env node` shebang).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod {tmp:?}: {e}"))?;
    }

    fs::rename(&tmp, &dest).map_err(|e| format!("rename {tmp:?} -> {dest:?}: {e}"))?;
    Ok(dest)
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

/// The shared set of sessions the subagents watcher recomputes for, held in
/// Tauri-managed state. The frontend keeps it current via the `subagents_for`
/// command (passing its app-launched panes' `{sessionId, cwd}`); the watcher reads
/// it on every recompute so a newly-launched session starts surfacing its
/// subagents without restarting the watch.
#[derive(Default)]
struct WatchedSessionsState(subagents::WatchedSessions);

/// Return the `session_id -> [Subagent]` map for the caller's app-launched
/// sessions, after updating the shared watched-set to `sessions`. Each session
/// supplies its `{sessionId, cwd}`; the cwd locates the Claude project dir
/// (`~/.claude/projects/<encoded-cwd>/<sessionId>/`). Reads the live
/// `workflows/*.json` run records, tolerating absent/partial/malformed ones. Used
/// both to SEED the frontend on mount and to push the watched-set whenever the
/// app's session set changes (subsequent live updates arrive over the
/// `overview://subagents` event). A session with no subagents maps to an empty
/// list; a missing projects dir yields an empty map, never an error.
#[tauri::command]
fn subagents_for(
    state: State<'_, WatchedSessionsState>,
    sessions: Vec<SessionRef>,
) -> Result<HashMap<String, Vec<Subagent>>, String> {
    // Update the shared watched-set so the watcher's next recompute uses it too.
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "watched-sessions lock poisoned")?;
        *guard = sessions.clone();
    }
    let projects_base =
        subagents::default_projects_base().ok_or("HOME unset; cannot locate ~/.claude/projects")?;
    Ok(subagents::subagents_for_sessions(&projects_base, &sessions))
}

/// Start the subagents watcher over `~/.claude/projects/`, emitting the
/// recomputed per-session subagent map to the frontend over
/// `overview://subagents`. Shares the watched-session set with the
/// `subagents_for` command so it is always current. The returned
/// [`SubagentsWatcher`] is held in managed state for the app's lifetime and
/// dropped cleanly on exit.
fn start_subagents_watcher(
    app: &AppHandle,
    sessions: subagents::WatchedSessions,
) -> Result<SubagentsWatcher, String> {
    let projects_base =
        subagents::default_projects_base().ok_or("HOME unset; cannot locate ~/.claude/projects")?;
    let handle = app.clone();
    subagents::start_subagents_watcher(&projects_base, sessions, move |map| {
        if let Err(e) = handle.emit(SUBAGENTS_EVENT, &map) {
            log::warn!("emit {SUBAGENTS_EVENT} failed: {e}");
        }
    })
}

/// Return the `pane_id -> Activity` map (last assistant message + any pending
/// question) for the caller's app panes. Each pane supplies its `{paneId, cwd}`;
/// the cwd locates the agent's transcript (the newest `*.jsonl` under
/// `~/.claude/projects/<encoded-cwd>/`), so this is INDEPENDENT of the statusline
/// snapshot — the frontend polls it on a short clock. A pane with no cwd or no
/// transcript is simply absent from the map.
#[tauri::command]
fn activity_for(panes: Vec<PaneRef>) -> Result<HashMap<String, Activity>, String> {
    let projects_base =
        activity::projects_base().ok_or("HOME unset; cannot locate ~/.claude/projects")?;
    Ok(activity::activity_for_panes(&projects_base, &panes))
}

/// Return the `path -> GitStatus` map for the given project FOLDERS (branch +
/// dirty + ahead/behind), computed by shelling out to git per folder (in
/// parallel). Unlike the footer's git (which rides a running agent's statusline
/// snapshot), this works for any project folder even with no agent running, so the
/// project pane shows each project's branch directly. Off-repo / no-remote folders
/// map to an all-null status; the call never fails. The frontend polls it slowly.
#[tauri::command(async)]
fn git_status_for(paths: Vec<String>) -> Result<HashMap<String, git::GitStatus>, String> {
    Ok(git::status_for_paths(&paths))
}

/// Push the project's current branch to its remote (`git push` in `repo_path`),
/// fired from the project row's context menu. Returns git's own message on
/// success; `Err(message)` on failure (no upstream / rejected / offline) so the
/// frontend can surface it in a toast.
#[tauri::command(async)]
fn git_push(repo_path: String) -> Result<String, String> {
    git::push(&repo_path)
}

/// Pull the project's current branch from its remote (`git pull` in `repo_path`),
/// fired from the project row's context menu. Returns git's own message on
/// success; `Err(message)` on failure (conflict / no upstream / offline) so the
/// frontend can surface it in a toast.
#[tauri::command(async)]
fn git_pull(repo_path: String) -> Result<String, String> {
    git::pull(&repo_path)
}

/// Create a fresh session worktree off `repo_path`'s HEAD (auto-worktree
/// projects). Returns `{ path, branch, base }`; ensures `.worktrees` is gitignored
/// and the branch is unique. `Err` when `repo_path` isn't a git repo or git fails.
#[tauri::command(async)]
fn worktree_create(repo_path: String) -> Result<git::WorktreeCreated, String> {
    git::worktree_create(&repo_path)
}

/// Remove a session worktree (and its branch) only if it's clean — empty
/// `status --porcelain` and zero commits past `base`. Returns `{ removed, reason }`;
/// a kept (dirty / has-commits) worktree is NOT an error. `Err` only on git failure.
#[tauri::command(async)]
fn worktree_remove_if_clean(
    worktree_path: String,
    base: String,
) -> Result<git::WorktreeRemoval, String> {
    git::worktree_remove_if_clean(&worktree_path, &base)
}

/// List the session worktrees under `<repo>/.worktrees/`, each as
/// `{ path, branch, clean }`, for the management UI. Off-repo yields `[]`.
#[tauri::command(async)]
fn worktree_list(repo_path: String) -> Result<Vec<git::WorktreeInfo>, String> {
    Ok(git::worktree_list(&repo_path))
}

/// Explicitly prune a worktree (and its branch), passing `--force` when `force`
/// is true. Used by the management UI. `Err` on git failure.
#[tauri::command(async)]
fn worktree_remove(worktree_path: String, force: bool) -> Result<(), String> {
    git::worktree_remove(&worktree_path, force)
}

/// Return the `pane_id -> [AgentEvent]` timeline for the caller's app panes, used
/// to SEED the overview's event store on mount/resume. For each pane the events
/// come from the in-memory ring (hot cache) first, then the durable per-session
/// sink (`events/<sessionId>.jsonl`) so a `claude --resume` shows its prior
/// timeline, then — for a session predating the event pipeline (no sink) — a
/// completed-tool timeline reconstructed from its transcript. A pane with no
/// session id, or no events anywhere, maps to an empty list.
#[tauri::command]
fn events_for(
    state: State<'_, Arc<EventState>>,
    panes: Vec<PaneRef>,
) -> Result<HashMap<String, Vec<AgentEvent>>, String> {
    let projects_base = activity::projects_base();
    let mut map = HashMap::new();
    for pane in &panes {
        let Some(sid) = pane.session_id.as_deref() else {
            continue;
        };
        let mut timeline = state.ring_for(&pane.pane_id);
        if timeline.is_empty() {
            timeline = state.sink_for(sid);
        }
        if timeline.is_empty() {
            if let Some(base) = projects_base.as_ref() {
                if let Some(transcript) = activity::find_transcript(base, pane) {
                    timeline = events::backfill_from_transcript(&transcript, &pane.pane_id, sid);
                }
            }
        }
        map.insert(pane.pane_id.clone(), timeline);
    }
    Ok(map)
}

/// Route the frontend executor's reply for an orchestration request back to the
/// in-flight control-socket request awaiting `id`. The frontend supplies exactly
/// one of `result` (success JSON) or `error` (a message); `error` wins if both are
/// somehow present. A reply for an unknown / already-timed-out id is a no-op (the
/// originating socket request already gave up), so it never errors. See
/// [`orchestration`].
#[tauri::command]
fn orchestration_reply(
    server: State<'_, Arc<orchestration::ControlServer>>,
    id: u64,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    let outcome = match error {
        Some(e) => orchestration::ReplyOutcome::Error(e),
        None => orchestration::ReplyOutcome::Result(result.unwrap_or(serde_json::Value::Null)),
    };
    server.pending().complete(id, outcome);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Native dialogs (the session launcher's folder picker uses
        // `open({ directory: true })`). Granted `dialog:allow-open` in
        // capabilities/default.json.
        .plugin(tauri_plugin_dialog::init())
        // Shell plugin: runs the bundled whisper.cpp `whisper-cli` STT sidecar
        // (voice input, Milestone 4). The sidecar scope is granted in
        // capabilities/default.json (`shell:allow-execute` + the externalBin
        // entry). See src/transcribe.rs.
        .plugin(tauri_plugin_shell::init())
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
            // Start the subagents watcher over ~/.claude/projects/, sharing the
            // watched-session set with the `subagents_for` command so a session
            // launched after startup begins surfacing its subagents. Held in
            // managed state for the app's lifetime; failure is logged but
            // non-fatal — the frontend still seeds via `subagents_for` and simply
            // won't receive live `overview://subagents` pushes.
            let watched = app.state::<WatchedSessionsState>().0.clone();
            match start_subagents_watcher(app.handle(), watched) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!("start_subagents_watcher failed: {e}"),
            }
            // Event pipeline: ALWAYS manage the shared event state (so `events_for`
            // resolves even if the socket can't bind), prune the durable sink on
            // boot, then best-effort start the Unix-socket server that emits each
            // parsed event over `overview://event`. A bind/emit failure is logged
            // but non-fatal — the overview falls back to transcript/PTW signals.
            let events_base = app_data_dir(app.handle())
                .map(|b| b.join(EVENTS_DIR))
                .unwrap_or_else(|_| std::env::temp_dir().join("agent-desktop-events"));
            let event_state = Arc::new(EventState::new(events_base));
            event_state.prune();
            app.manage(event_state.clone());
            if let Ok(base) = app_data_dir(app.handle()) {
                let handle = app.handle().clone();
                match events::start_event_server(&base.join(SOCKET_FILE), event_state, move |ev| {
                    if let Err(e) = handle.emit(EVENT_EVENT, &ev) {
                        log::warn!("emit {EVENT_EVENT} failed: {e}");
                    }
                }) {
                    Ok(server) => {
                        app.manage(server);
                    }
                    Err(e) => log::warn!("start_event_server failed: {e}"),
                }
            }
            // Orchestration control socket: the transport the bundled MCP toolkit
            // adapter uses to round-trip toolkit ops through the frontend executor.
            // Each inbound request is emitted to the frontend over
            // `orchestration://request`; the frontend replies via the
            // `orchestration_reply` command, routed back through the server's pending
            // registry. Held in managed state (so `orchestration_reply` can reach the
            // registry and the listener lives for the app's lifetime). A bind failure
            // is logged but non-fatal — the orchestration toolkit simply won't work.
            if let Ok(base) = app_data_dir(app.handle()) {
                let handle = app.handle().clone();
                match orchestration::start_control_server(
                    &base.join(CONTROL_SOCKET_FILE),
                    move |id, req| {
                        if let Err(e) = handle.emit(
                            orchestration::REQUEST_EVENT,
                            serde_json::json!({ "id": id, "op": req.op, "args": req.args }),
                        ) {
                            log::warn!("emit {} failed: {e}", orchestration::REQUEST_EVENT);
                        }
                    },
                ) {
                    Ok(server) => {
                        app.manage(Arc::new(server));
                    }
                    Err(e) => log::warn!("start_control_server failed: {e}"),
                }
            }
            // Install the native double-tap-right-Command monitor that emits
            // `voice://activate` for the voice panel. Best-effort and macOS-only;
            // a failure is logged inside `start` (the mic button is the fallback).
            voice_activation::start(app.handle().clone());
            Ok(())
        })
        .manage(Arc::new(PtyManager::new()))
        .manage(WatchedSessionsState::default())
        // The single transcript-polish llama-server manager (lazy-started by
        // `voice_polish`). Held in managed state so it lives for the app's
        // lifetime and the spawned sidecar is reaped on exit.
        .manage(Arc::new(polish::LlamaServer::default()))
        // The single live-partials whisper-server manager (lazy-started by
        // `voice_transcribe_partial`). Managed so it lives for the app's lifetime
        // and the spawned sidecar is reaped on exit; keeps the tiny model resident.
        .manage(Arc::new(whisper_server::WhisperServer::default()))
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            open_in_editor,
            resolve_path,
            open_path,
            session_focus,
            layout_load,
            layout_save,
            recents_load,
            recents_save,
            projects_load,
            projects_save,
            settings_load,
            settings_save,
            terminals_load,
            terminals_save,
            tasks_load,
            tasks_save,
            tasks_clear,
            terminals_clear,
            specialists_list,
            specialists_read,
            specialists_write,
            specialists_delete,
            project_tasks_load,
            project_tasks_save,
            project_config_load,
            project_config_save,
            usage_paths,
            usage_snapshots,
            subagents_for,
            activity_for,
            git_status_for,
            git_push,
            git_pull,
            worktree_create,
            worktree_remove_if_clean,
            worktree_list,
            worktree_remove,
            events_for,
            orchestration_reply,
            transcribe::voice_transcribe_final,
            transcribe::voice_transcribe_stream,
            models::voice_download_models,
            models::voice_models_status,
            models::voice_models_disk_usage,
            models::voice_delete_models,
            polish::voice_polish,
            whisper_server::voice_transcribe_partial,
            voice_bundled_model_path,
            voice_model_path
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
    fn clean_title_takes_first_nonempty_line_and_strips_decoration() {
        assert_eq!(clean_title("\n  \"Fix login bug\".  \n"), "Fix login bug");
        assert_eq!(
            clean_title("Improve frontend dialog handling\nextra line"),
            "Improve frontend dialog handling"
        );
    }

    #[test]
    fn clean_title_drops_think_blocks() {
        assert_eq!(
            clean_title("<think>let me reason\nabout this</think>\nSKIPA-45: Fix Feature"),
            "SKIPA-45: Fix Feature"
        );
        // Case-insensitive tag, title on the same trailing segment.
        assert_eq!(
            clean_title("<THINK>hmm</THINK> Add dark mode"),
            "Add dark mode"
        );
        // Unterminated think block → no title leaks out.
        assert_eq!(clean_title("<think>never closes"), "");
    }

    #[test]
    fn strip_think_blocks_handles_multibyte_before_tag_without_panic() {
        // `İ` (U+0130) lowercases to TWO code points, so byte offsets found in a
        // `to_lowercase()` copy would drift off `s` — these used to panic / corrupt.
        // Offsets must stay valid for the original string.
        assert_eq!(strip_think_blocks("İ<think>x</think>Y"), "İY");
        assert_eq!(strip_think_blocks("İİ<think>x</think>Z"), "İİZ");
        // A multi-byte char INSIDE the reasoning block is dropped with it.
        assert_eq!(
            clean_title("<think>İİİ reasoning</think>\nFix the café page"),
            "Fix the café page"
        );
    }

    #[test]
    fn clean_title_clips_to_60_chars() {
        let long = "a".repeat(100);
        assert_eq!(clean_title(&long).chars().count(), 60);
    }

    #[test]
    fn clean_title_empty_for_blank_input() {
        assert_eq!(clean_title(""), "");
        assert_eq!(clean_title("   \n  "), "");
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

        // The event hook is installed beside the wrapper (same baked-source +
        // shebang + 0755 contract) and the durable events dir + socket path are
        // returned, so the event pipeline is wired at spawn.
        let hook = PathBuf::from(&paths.event_hook_path);
        assert_eq!(hook, tmp.path().join(BIN_DIR).join(EVENT_HOOK_FILE));
        assert!(hook.is_file(), "event hook must exist");
        let hook_src = fs::read_to_string(&hook).unwrap();
        assert_eq!(hook_src, EVENT_HOOK_SRC);
        assert!(hook_src.starts_with("#!/usr/bin/env node"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&hook).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755, "event hook must be mode 0755");
        }
        // The socket path sits at the app-data root and the events dir exists.
        assert_eq!(
            PathBuf::from(&paths.socket_path),
            tmp.path().join(SOCKET_FILE)
        );
        assert!(
            tmp.path().join(EVENTS_DIR).is_dir(),
            "events dir must exist"
        );

        // The orchestration MCP adapter is installed beside the wrapper (same baked
        // source + shebang + 0755 contract) and the control socket path (sibling of
        // the events socket) is returned for the coordinator's --mcp-config server.
        let adapter = PathBuf::from(&paths.adapter_path);
        assert_eq!(adapter, tmp.path().join(BIN_DIR).join(ORCHESTRATION_MCP_FILE));
        assert!(adapter.is_file(), "orchestration adapter must exist");
        let adapter_src = fs::read_to_string(&adapter).unwrap();
        assert_eq!(adapter_src, ORCHESTRATION_MCP_SRC);
        assert!(adapter_src.starts_with("#!/usr/bin/env node"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&adapter).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755, "adapter must be mode 0755");
        }
        assert_eq!(
            PathBuf::from(&paths.control_socket_path),
            tmp.path().join(CONTROL_SOCKET_FILE)
        );
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
