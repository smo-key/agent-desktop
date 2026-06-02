//! Task-detection core + foreign-session watcher for the `task-detection`
//! capability (Milestone 4, design D7).
//!
//! M3 already embeds a `task` field in each per-pane snapshot (the statusline
//! wrapper computes it; the dashboard reads it). M4 ADDS two things on top of
//! that, both implemented here:
//!
//!   1. A reusable, PURE, unit-tested derivation that mirrors the wrapper's task
//!      logic in Rust: given `~/.claude/tasks/<session_id>/`, read every
//!      `*.json`, pick the newest-by-mtime entry whose `status` is
//!      `"in_progress"`, and return its `activeForm` (schema-tolerant fallback
//!      `activeForm` -> `subject` -> `content`). This is the same algorithm the
//!      wrapper applies, factored out so it is testable and reusable for foreign
//!      sessions.
//!
//!   2. A foreign-session WATCHER (`notify`) over `~/.claude/tasks/` and the
//!      `$TMPDIR/claude-ctx-<session>.json` context-bridge files. It builds a
//!      `session_id -> {task, context_pct, ts}` map and pushes it to the frontend
//!      as a Tauri event (`usage://foreign`). CRITICAL: the result EXCLUDES
//!      session ids that belong to app-launched panes (the frontend supplies that
//!      set from its per-pane snapshots, which each carry a `session_id`) so the
//!      app never double-counts its own panes — once as an app card, again as a
//!      "foreign" one.
//!
//! Every load-bearing piece — task derivation, schema fallback, the context
//! bridge parse, the "foreign = all task-dir sessions minus app sessions" filter,
//! and the live/idle heartbeat — is a PURE function with unit tests named after
//! the task-detection spec scenarios. The `notify` integration itself is exercised
//! headlessly at the module level (`foreign_watcher_emits_on_change`); the live
//! in-app wiring against a real `claude` session is the only MANUAL aspect.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

/// The Tauri event name the foreign-session watcher emits the (filtered) list of
/// foreign sessions on. The frontend listens on exactly this name.
pub const FOREIGN_EVENT: &str = "usage://foreign";

/// Default heartbeat-staleness threshold: a session whose entry `ts` is older
/// than this (relative to "now") is considered idle/ended rather than live. ~10s
/// matches the statusline render cadence with headroom (the wrapper re-renders
/// every few hundred ms while a session is alive).
pub const LIVENESS_THRESHOLD: Duration = Duration::from_secs(10);

/// Coalescing window for the foreign watcher: identical recomputations triggered
/// by a burst of fs events for one logical write are suppressed within this span.
/// macOS FSEvents fires several events per write; this keeps us from re-emitting
/// the same foreign list many times in a row.
const COALESCE_WINDOW: Duration = Duration::from_millis(250);

// ---------------------------------------------------------------------------
// Task entry schema (schema-tolerant).
// ---------------------------------------------------------------------------

/// One task entry as stored in `~/.claude/tasks/<session_id>/<N>.json`.
///
/// The documented schema is `{id, subject, description, activeForm, status,
/// blocks, blockedBy}`, but we are deliberately schema-TOLERANT for forward/back
/// compatibility across Claude Code versions: every field is optional and unknown
/// extra fields are ignored (no `deny_unknown_fields`). We only ever read
/// `status` (to select in-progress entries) and the label fields `activeForm` /
/// `subject` / `content`, in that fallback order.
#[derive(Debug, Clone, Default, Deserialize)]
struct TaskEntry {
    /// `"pending" | "in_progress" | "completed"` (or anything else). Only
    /// `"in_progress"` entries are candidates for the current task.
    #[serde(default)]
    status: Option<String>,
    /// Primary task label (present-tense gerund, e.g. "Refactoring the watcher").
    #[serde(default, rename = "activeForm")]
    active_form: Option<String>,
    /// Fallback label when `activeForm` is absent (older schema).
    #[serde(default)]
    subject: Option<String>,
    /// Second fallback label (other schema drift); read last.
    #[serde(default)]
    content: Option<String>,
}

impl TaskEntry {
    /// The task label per the fallback order `activeForm` -> `subject` ->
    /// `content`, treating empty/whitespace-only strings as absent. `None` when
    /// no field yields a non-empty label.
    fn label(&self) -> Option<String> {
        non_empty(self.active_form.as_deref())
            .or_else(|| non_empty(self.subject.as_deref()))
            .or_else(|| non_empty(self.content.as_deref()))
    }
}

/// Trim a candidate string; return it owned only when non-empty after trimming.
fn non_empty(v: Option<&str>) -> Option<String> {
    let t = v?.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

// ---------------------------------------------------------------------------
// (1) PURE task derivation from a live tasks directory.
// ---------------------------------------------------------------------------

/// Derive the current task for a session given its tasks directory
/// (`~/.claude/tasks/<session_id>/`).
///
/// Reads every `*.json` entry, keeps only those with `status: "in_progress"` that
/// yield a non-empty label, and returns the label of the NEWEST one by file
/// mtime. `status` of `pending`/`completed` (or anything not `in_progress`) is
/// ignored. Returns `None` when the directory is absent/unreadable or no
/// in-progress entry yields a label. Never panics: any per-file IO/parse error is
/// skipped, mirroring the wrapper's "best-effort, never throw" behavior.
pub fn derive_task(tasks_dir: &Path) -> Option<String> {
    let entries = std::fs::read_dir(tasks_dir).ok()?;
    let mut best: Option<(SystemTime, String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_json = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"));
        if !is_json {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<TaskEntry>(&text) else {
            continue;
        };
        if parsed.status.as_deref() != Some("in_progress") {
            continue;
        }
        let Some(label) = parsed.label() else {
            continue;
        };
        // mtime drives "newest wins"; a file whose mtime is unreadable falls back
        // to UNIX_EPOCH so a readable-mtime peer always beats it.
        let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
        match &best {
            Some((best_mtime, _)) if *best_mtime >= mtime => {}
            _ => best = Some((mtime, label)),
        }
    }
    best.map(|(_, label)| label)
}

/// Convenience: derive the current task for `session_id` rooted at a `tasks` base
/// directory (i.e. `<tasks_base>/<session_id>/`). `tasks_base` is normally
/// `~/.claude/tasks`. A session id containing path separators is rejected (returns
/// `None`) so it can never escape the base.
pub fn derive_task_for_session(tasks_base: &Path, session_id: &str) -> Option<String> {
    let safe = safe_session_id(session_id)?;
    derive_task(&tasks_base.join(safe))
}

/// Reject a session id that could escape its parent dir via path separators or
/// `..`; otherwise return it unchanged. Mirrors the wrapper's `safeSessionId`.
fn safe_session_id(id: &str) -> Option<&str> {
    let t = id.trim();
    if t.is_empty() || t.contains('/') || t.contains('\\') || t.contains("..") {
        None
    } else {
        Some(t)
    }
}

// ---------------------------------------------------------------------------
// (2) PURE context-bridge parse.
// ---------------------------------------------------------------------------

/// The parsed context-bridge values for a foreign session, read from
/// `$TMPDIR/claude-ctx-<session_id>.json`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ContextBridge {
    /// Context-window usage 0..100. Taken from `used_pct` when present, else
    /// derived as `100 - remaining_percentage`. `None` when neither is available.
    pub used_pct: Option<f64>,
    /// `remaining_percentage` verbatim (0..100), or `None`.
    pub remaining_percentage: Option<f64>,
    /// `timestamp` (unix seconds) of the bridge write, or `None`.
    pub ts: Option<i64>,
}

/// Raw deserialization target for the bridge file. Schema-tolerant: every field
/// optional, unknown fields ignored. The documented shape is `{session_id,
/// remaining_percentage, used_pct, timestamp}`.
#[derive(Debug, Default, Deserialize)]
struct ContextBridgeRaw {
    #[serde(default)]
    used_pct: Option<f64>,
    #[serde(default)]
    remaining_percentage: Option<f64>,
    #[serde(default)]
    timestamp: Option<i64>,
}

/// Parse a context-bridge JSON string into a [`ContextBridge`]. Returns `None`
/// only when the text is not valid JSON; a valid object with missing fields parses
/// to a `ContextBridge` whose corresponding fields are `None`. `used_pct` is taken
/// verbatim when present, otherwise derived from `remaining_percentage`
/// (`100 - remaining`) so the card always has a usable percentage when either is
/// available.
pub fn parse_context_bridge(text: &str) -> Option<ContextBridge> {
    let raw = serde_json::from_str::<ContextBridgeRaw>(text).ok()?;
    let used_pct = raw.used_pct.filter(|v| v.is_finite()).or_else(|| {
        raw.remaining_percentage
            .filter(|v| v.is_finite())
            .map(|r| 100.0 - r)
    });
    Some(ContextBridge {
        used_pct,
        remaining_percentage: raw.remaining_percentage.filter(|v| v.is_finite()),
        ts: raw.timestamp,
    })
}

/// Read + parse the context bridge file for `session_id` under `tmp_dir`
/// (`$TMPDIR/claude-ctx-<session_id>.json`). `None` when the file is absent,
/// unreadable, or unparseable, or when `session_id` is unsafe.
pub fn read_context_bridge(tmp_dir: &Path, session_id: &str) -> Option<ContextBridge> {
    let safe = safe_session_id(session_id)?;
    let path = tmp_dir.join(format!("claude-ctx-{safe}.json"));
    let text = std::fs::read_to_string(path).ok()?;
    parse_context_bridge(&text)
}

// ---------------------------------------------------------------------------
// (3) PURE foreign-set filter + liveness.
// ---------------------------------------------------------------------------

/// One foreign Claude session surfaced to the frontend: a session running OUTSIDE
/// the app (no app-managed snapshot), with its derived task + context + heartbeat.
/// Serialized snake_case to match the snapshot wire shape the frontend already
/// keys on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ForeignSession {
    /// The Claude session id (the tasks-dir name and the frontend map key).
    pub session_id: String,
    /// Derived current task (newest `in_progress` `activeForm`), or `null`.
    pub task: Option<String>,
    /// Context-window usage 0..100 from the context bridge, or `null`.
    pub context_pct: Option<f64>,
    /// Heartbeat: newest of the task-entry mtime / bridge timestamp, unix seconds,
    /// or `null` when neither is known. Drives the live/idle dot.
    pub ts: Option<i64>,
}

/// Compute the FOREIGN session-id set: every session that has a directory under
/// the tasks base, MINUS the set of app-launched session ids the frontend supplied
/// (from its per-pane snapshots). This is the load-bearing "don't double-count our
/// own panes" filter, kept pure and tested. The returned ids are sorted for a
/// stable, deterministic order. Unsafe (separator-bearing) dir names are ignored.
pub fn foreign_session_ids(tasks_base: &Path, app_sessions: &HashSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(tasks_base) else {
        return out;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if safe_session_id(&name).is_none() {
            continue;
        }
        if app_sessions.contains(&name) {
            continue; // belongs to an app pane — its task comes from the snapshot.
        }
        out.push(name);
    }
    out.sort();
    out
}

/// Classify a session as live vs idle from its heartbeat `ts` (unix seconds)
/// relative to `now` (unix seconds): live when `ts` is within `threshold` of
/// `now`, idle when it is older (stale). A `None`/absent `ts` is treated as idle
/// (no heartbeat). A future `ts` (clock skew) is treated as live.
pub fn is_live(ts: Option<i64>, now: i64, threshold: Duration) -> bool {
    let Some(ts) = ts else { return false };
    let age = now - ts;
    age <= threshold.as_secs() as i64
}

// ---------------------------------------------------------------------------
// (4) Compose the foreign-session list (pure, given the filesystem roots).
// ---------------------------------------------------------------------------

/// Build the full foreign-session list: for every foreign session id (all
/// task-dir sessions minus `app_sessions`), derive its task from
/// `<tasks_base>/<id>/` and its context + heartbeat from
/// `<tmp_dir>/claude-ctx-<id>.json`. `ts` is the newest of the in-progress task
/// entry mtime and the bridge timestamp (unix seconds), so a session with either
/// signal carries a heartbeat. The result is sorted by `session_id` for a stable
/// order and EXCLUDES every app-launched session.
pub fn compute_foreign_sessions(
    tasks_base: &Path,
    tmp_dir: &Path,
    app_sessions: &HashSet<String>,
) -> Vec<ForeignSession> {
    foreign_session_ids(tasks_base, app_sessions)
        .into_iter()
        .map(|session_id| {
            let dir = tasks_base.join(&session_id);
            let task = derive_task(&dir);
            let task_mtime = newest_task_mtime(&dir);
            let bridge = read_context_bridge(tmp_dir, &session_id);
            let context_pct = bridge.and_then(|b| b.used_pct);
            let bridge_ts = bridge.and_then(|b| b.ts);
            let ts = max_opt(task_mtime, bridge_ts);
            ForeignSession {
                session_id,
                task,
                context_pct,
                ts,
            }
        })
        .collect()
}

/// Newest mtime (unix seconds) of any `*.json` entry in `dir`, or `None` when the
/// dir is absent/empty. Used as a task-side heartbeat for foreign sessions.
fn newest_task_mtime(dir: &Path) -> Option<i64> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut newest: Option<i64> = None;
    for entry in entries.flatten() {
        let is_json = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"));
        if !is_json {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Some(secs) = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
        else {
            continue;
        };
        newest = Some(newest.map_or(secs, |n| n.max(secs)));
    }
    newest
}

/// The larger of two optional unix timestamps; `None` only when both are `None`.
fn max_opt(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, b) => b,
    }
}

// ---------------------------------------------------------------------------
// (5) The foreign-session WATCHER (notify).
// ---------------------------------------------------------------------------

/// The shared app-session exclude-set: the session ids of app-launched panes the
/// frontend supplies (from its per-pane snapshots). Shared between the
/// `foreign_sessions` command (which updates it) and the watcher (which reads it
/// on every recompute) so changing which panes the app owns immediately changes
/// what the watcher reports as foreign.
pub type AppSessions = Arc<Mutex<HashSet<String>>>;

/// Owns the live `notify` watcher(s) for the foreign-session sources
/// (`~/.claude/tasks/` and the `$TMPDIR` bridge dir). Dropping it stops the watch:
/// the watcher's own `Drop` tears down the platform backend + thread. Held in
/// Tauri-managed state for the app's lifetime.
pub struct ForeignWatcher {
    /// The platform watcher. Kept so its `Drop` runs when this is dropped.
    _watcher: RecommendedWatcher,
    /// The tasks base being watched (handy for diagnostics/tests).
    tasks_base: PathBuf,
}

impl ForeignWatcher {
    /// The tasks base directory this watcher is watching.
    pub fn tasks_base(&self) -> &Path {
        &self.tasks_base
    }
}

/// The watcher's own recompute-coalescing state (suppresses an identical list
/// re-emitted within [`COALESCE_WINDOW`] across a burst of fs events).
#[derive(Default)]
struct EmitState {
    last_emit: Option<(Vec<ForeignSession>, Instant)>,
}

/// Start watching the foreign-session sources, invoking `on_foreign` with the
/// freshly-computed (filtered) list on every relevant fs change under either the
/// tasks base or the tmp/bridge dir. `app_sessions` is the SHARED exclude-set
/// (read on every recompute) so the `foreign_sessions` command can update which
/// panes the app owns without restarting the watcher. [`ForeignWatcher`] must be
/// kept alive (dropping it stops the watch).
///
/// `on_foreign` runs on the watcher's event thread; it must be `Send`. In
/// production it emits the Tauri `usage://foreign` event; in tests it pushes to a
/// channel. Trivial duplicate recomputations (same list within
/// [`COALESCE_WINDOW`]) are suppressed.
pub fn start_foreign_watcher<F>(
    tasks_base: &Path,
    tmp_dir: &Path,
    app_sessions: AppSessions,
    on_foreign: F,
) -> Result<ForeignWatcher, String>
where
    F: Fn(Vec<ForeignSession>) + Send + 'static,
{
    // Ensure the tasks base exists so `watch` doesn't fail before any session has
    // ever written a task (fresh machine / first launch).
    std::fs::create_dir_all(tasks_base)
        .map_err(|e| format!("create_dir_all {tasks_base:?}: {e}"))?;

    let tasks_base_owned = tasks_base.to_path_buf();
    let tmp_dir_owned = tmp_dir.to_path_buf();
    // Candidate prefixes for the path filter: both the raw base AND its
    // canonicalized form, because notify reports canonicalized event paths on
    // macOS (e.g. `/private/var/...`) while the watched base may be the symlinked
    // `/var/...`. Matching either keeps the filter correct across that difference.
    let tasks_prefixes = base_prefixes(&tasks_base_owned);
    let tmp_prefixes = base_prefixes(&tmp_dir_owned);
    let emit = Mutex::new(EmitState::default());

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else {
            return; // watch error: ignore, keep watching.
        };
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        ) {
            return;
        }
        // FILTER by path before doing any work (no lock, no full walk for an
        // irrelevant event). macOS FSEvents fires for many unrelated files; we
        // only recompute when an event touches a real foreign-session source:
        //   - under the tmp/bridge dir: a `claude-ctx-*.json` context bridge file
        //   - under the tasks base: any `*.json` task entry
        // An event carrying no relevant path is skipped entirely.
        if !event
            .paths
            .iter()
            .any(|p| is_relevant_event_path(p, &tasks_prefixes, &tmp_prefixes))
        {
            return;
        }
        // Snapshot the shared exclude-set, then recompute against the filesystem.
        let app = lock_set(&app_sessions);
        let list = compute_foreign_sessions(&tasks_base_owned, &tmp_dir_owned, &app);
        drop(app);
        // Coalesce: suppress an identical list re-emitted within the window.
        let mut guard = match emit.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let now = Instant::now();
        if let Some((last, when)) = &guard.last_emit {
            if *last == list && now.duration_since(*when) < COALESCE_WINDOW {
                return;
            }
        }
        guard.last_emit = Some((list.clone(), now));
        drop(guard);
        on_foreign(list);
    })
    .map_err(|e| format!("recommended_watcher: {e}"))?;

    watcher
        .watch(tasks_base, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {tasks_base:?}: {e}"))?;
    // The bridge dir may not exist yet; watch it best-effort (a missing/!exists
    // tmp dir simply means no bridge files to react to until one appears).
    if tmp_dir.exists() {
        let _ = watcher.watch(tmp_dir, RecursiveMode::NonRecursive);
    }

    Ok(ForeignWatcher {
        _watcher: watcher,
        tasks_base: tasks_base.to_path_buf(),
    })
}

/// The distinct prefix candidates for a watched base: the base itself plus its
/// canonicalized form when that differs (notify reports canonicalized event paths
/// on macOS, e.g. `/private/var/...`, while the base may be the symlinked
/// `/var/...`). Used by [`is_relevant_event_path`] to match either spelling.
fn base_prefixes(base: &Path) -> Vec<PathBuf> {
    let mut out = vec![base.to_path_buf()];
    if let Ok(canon) = std::fs::canonicalize(base) {
        if canon != *base {
            out.push(canon);
        }
    }
    out
}

/// Whether an fs-event `path` is a real foreign-session source worth recomputing
/// for. Relevant when it is:
///   - under any `tmp_prefixes` AND its file name matches `claude-ctx-*.json` (a
///     context bridge file — note the wrapper writes a dot-prefixed `.tmp` sibling
///     which does NOT match, so a half-written bridge is ignored), or
///   - under any `tasks_prefixes` AND it is a `*.json` file (a task entry).
///
/// Each base contributes both its raw and canonicalized spelling (see
/// [`base_prefixes`]). Any other path (unrelated file, or a `.tmp`/non-json) is
/// irrelevant.
fn is_relevant_event_path(
    path: &Path,
    tasks_prefixes: &[PathBuf],
    tmp_prefixes: &[PathBuf],
) -> bool {
    let is_json = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));

    // Bridge file directly under the tmp dir: claude-ctx-*.json.
    if tmp_prefixes.iter().any(|p| path.starts_with(p)) {
        if !is_json {
            return false;
        }
        return path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| name.starts_with("claude-ctx-"));
    }

    // Task entry under the tasks base: any *.json.
    if tasks_prefixes.iter().any(|p| path.starts_with(p)) {
        return is_json;
    }

    false
}

/// Lock the shared app-session set, recovering from poisoning (a prior panic on
/// another thread must not wedge the watcher).
fn lock_set(set: &AppSessions) -> std::sync::MutexGuard<'_, HashSet<String>> {
    match set.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

/// Resolve the default tasks base (`~/.claude/tasks`) from the environment.
/// `None` when `$HOME` is unset.
pub fn default_tasks_base() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".claude").join("tasks"))
}

/// Resolve the context-bridge tmp dir: `$TMPDIR` when set, else the platform temp
/// dir. The bridge files live directly under this as `claude-ctx-<session>.json`.
pub fn default_tmp_dir() -> PathBuf {
    std::env::var_os("TMPDIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::sync::Arc;

    /// A throwaway dir under the system temp dir, removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-task-{tag}-{nanos}"));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Write `body` to `<dir>/<name>` then bump its mtime to `secs` past the epoch
    /// so "newest by mtime" is deterministic (not dependent on write order/clock
    /// resolution). Uses `filetime` semantics via a manual set through `utimes`.
    fn write_with_mtime(dir: &Path, name: &str, body: &str, secs: u64) {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        set_mtime(&path, secs);
    }

    /// Set a file's mtime to `secs` seconds past the unix epoch (test helper).
    fn set_mtime(path: &Path, secs: u64) {
        // Use libc utimes via std is not available; emulate by re-opening with a
        // SystemTime through the `filetime`-less approach: write then touch with
        // an explicit time using `set_file_mtime` from std is unstable, so we go
        // through a small unsafe utimensat-free path: write a sentinel then sleep
        // is too flaky. Instead, set times via std::fs::File + set_modified
        // (stable since 1.75).
        let when = UNIX_EPOCH + Duration::from_secs(secs);
        let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_modified(when).unwrap();
    }

    // ----- Derive Current Task From Live Tasks Directory ----------------------

    /// Scenario: Newest in_progress entry wins.
    /// Multiple in_progress entries -> the newest-by-mtime entry's activeForm
    /// wins; pending/completed entries are ignored entirely.
    #[test]
    fn newest_in_progress_entry_wins() {
        let tmp = TempDir::new("newest");
        let dir = tmp.path();
        // Older in_progress
        write_with_mtime(
            dir,
            "1.json",
            r#"{"id":"1","status":"in_progress","activeForm":"Older task"}"#,
            1_000,
        );
        // A completed entry that is the NEWEST file overall — must be ignored.
        write_with_mtime(
            dir,
            "2.json",
            r#"{"id":"2","status":"completed","activeForm":"Done thing"}"#,
            5_000,
        );
        // Newer in_progress — this one must win.
        write_with_mtime(
            dir,
            "3.json",
            r#"{"id":"3","status":"in_progress","activeForm":"Newer task"}"#,
            3_000,
        );
        // A pending entry, also ignored.
        write_with_mtime(
            dir,
            "4.json",
            r#"{"id":"4","status":"pending","activeForm":"Future task"}"#,
            4_000,
        );
        assert_eq!(derive_task(dir).as_deref(), Some("Newer task"));
    }

    /// Scenario: No in_progress entry yields null task.
    /// A dir with only pending/completed entries (or an absent dir) yields None,
    /// surfaced as a null task label rather than an error.
    #[test]
    fn no_in_progress_entry_yields_null_task() {
        let tmp = TempDir::new("none");
        let dir = tmp.path();
        write_with_mtime(
            dir,
            "1.json",
            r#"{"id":"1","status":"pending","activeForm":"Pending task"}"#,
            1_000,
        );
        write_with_mtime(
            dir,
            "2.json",
            r#"{"id":"2","status":"completed","activeForm":"Completed task"}"#,
            2_000,
        );
        assert_eq!(derive_task(dir), None, "no in_progress -> None");

        // An absent directory is likewise None (not an error/panic).
        let absent = dir.join("does-not-exist");
        assert_eq!(derive_task(&absent), None, "absent dir -> None");
    }

    // ----- Tolerate Task Schema Variations And Fallback Fields ----------------

    /// Scenario: activeForm present.
    /// A non-empty activeForm is used verbatim as the task label. (Test fn name is
    /// the gate's snake form of "activeForm present" -> `activeform_present`.)
    #[test]
    fn activeform_present() {
        let tmp = TempDir::new("activeform");
        let dir = tmp.path();
        write_with_mtime(
            dir,
            "1.json",
            r#"{"id":"1","status":"in_progress","activeForm":"Refactoring the watcher","subject":"Refactor"}"#,
            1_000,
        );
        assert_eq!(derive_task(dir).as_deref(), Some("Refactoring the watcher"));
    }

    /// Scenario: activeForm missing, subject present.
    /// With no activeForm the label falls back to subject, and with neither it
    /// falls back to content. (Gate snake form -> `activeform_missing_subject_present`.)
    #[test]
    fn activeform_missing_subject_present() {
        let tmp = TempDir::new("subject");
        let dir = tmp.path();
        // No activeForm -> subject used.
        write_with_mtime(
            dir,
            "1.json",
            r#"{"id":"1","status":"in_progress","subject":"Subject label"}"#,
            1_000,
        );
        assert_eq!(derive_task(dir).as_deref(), Some("Subject label"));

        // Newer entry with neither activeForm nor subject -> content used.
        write_with_mtime(
            dir,
            "2.json",
            r#"{"id":"2","status":"in_progress","content":"Content label"}"#,
            2_000,
        );
        assert_eq!(derive_task(dir).as_deref(), Some("Content label"));
    }

    /// Scenario: Unknown extra fields do not break parsing.
    /// Extra undocumented fields and omitted blocks/blockedBy still parse, and a
    /// label is derived without raising. An empty activeForm falls through to the
    /// next field.
    #[test]
    fn unknown_extra_fields_do_not_break_parsing() {
        let tmp = TempDir::new("extra");
        let dir = tmp.path();
        write_with_mtime(
            dir,
            "1.json",
            r#"{
                "id":"1","status":"in_progress","activeForm":"  ",
                "subject":"Falls back here","description":"ignored",
                "futureField":{"nested":[1,2,3]},"another":42
            }"#,
            1_000,
        );
        // Empty/whitespace activeForm is treated as absent -> subject used; the
        // unknown fields and missing blocks/blockedBy do not break parsing.
        assert_eq!(derive_task(dir).as_deref(), Some("Falls back here"));
    }

    // ----- Snapshot Is The Primary Task Source For App-Launched Sessions ------
    //       (the exclude-app-sessions filter)

    /// Scenario: Task read from snapshot.
    /// The foreign-set filter EXCLUDES app-launched session ids: a session present
    /// in the tasks dir AND in the app-session set is not surfaced as foreign (its
    /// task is read from the snapshot the dashboard already watches), so the app
    /// never double-counts its own panes. Only genuinely-foreign sessions remain.
    #[test]
    fn snapshot_is_the_primary_task_source_for_app_launched_sessions() {
        let tmp = TempDir::new("exclude");
        let base = tmp.path();
        for sid in ["app-sess-a", "app-sess-b", "foreign-sess-c"] {
            std::fs::create_dir_all(base.join(sid)).unwrap();
            write_with_mtime(
                &base.join(sid),
                "1.json",
                r#"{"id":"1","status":"in_progress","activeForm":"t"}"#,
                1_000,
            );
        }
        let app: HashSet<String> = ["app-sess-a".to_string(), "app-sess-b".to_string()]
            .into_iter()
            .collect();
        // All task-dir sessions minus app sessions == just the foreign one.
        assert_eq!(foreign_session_ids(base, &app), vec!["foreign-sess-c"]);

        // With no app sessions, every task-dir session is foreign (sorted).
        let none = HashSet::new();
        assert_eq!(
            foreign_session_ids(base, &none),
            vec!["app-sess-a", "app-sess-b", "foreign-sess-c"]
        );

        // And the composed list likewise excludes app sessions.
        let composed = compute_foreign_sessions(base, base, &app);
        let ids: Vec<&str> = composed.iter().map(|f| f.session_id.as_str()).collect();
        assert_eq!(ids, vec!["foreign-sess-c"]);
    }

    // ----- Direct-Watch Fallback For Foreign Sessions -------------------------
    //
    // The requirement has three scenarios, each with its own gate-named test:
    //   foreign_session_task_surfaced / context_bridge_fallback /
    //   missing_todos_directory_is_not_required. A `direct_watch_fallback_for_
    //   foreign_sessions` umbrella (the REQUIREMENT name the task asks for by name)
    //   exercises the composed parse end-to-end.

    /// Build a fake foreign-session tasks dir + bridge file, returning the
    /// (tasks_base, tmp_dir) temp dirs. `sid` gets a completed + a newer
    /// in_progress task entry and a bridge with `used_pct` present.
    fn fake_foreign(sid: &str) -> (TempDir, TempDir) {
        let tasks = TempDir::new("fallback-tasks");
        let tmp = TempDir::new("fallback-tmp");
        let sdir = tasks.path().join(sid);
        std::fs::create_dir_all(&sdir).unwrap();
        write_with_mtime(
            &sdir,
            "1.json",
            r#"{"id":"1","status":"completed","activeForm":"old"}"#,
            1_000,
        );
        write_with_mtime(
            &sdir,
            "2.json",
            r#"{"id":"2","status":"in_progress","activeForm":"Investigating the bug"}"#,
            2_000,
        );
        std::fs::write(
            tmp.path().join(format!("claude-ctx-{sid}.json")),
            r#"{"session_id":"foreign-1","remaining_percentage":63.0,"used_pct":37.0,"timestamp":2500}"#,
        )
        .unwrap();
        (tasks, tmp)
    }

    /// Scenario: Foreign session task surfaced.
    /// A foreign session (no app snapshot) has its task derived directly from its
    /// newest in_progress entry under `~/.claude/tasks/<id>/`.
    #[test]
    fn foreign_session_task_surfaced() {
        let (tasks, tmp) = fake_foreign("foreign-1");
        let list = compute_foreign_sessions(tasks.path(), tmp.path(), &HashSet::new());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].session_id, "foreign-1");
        assert_eq!(list[0].task.as_deref(), Some("Investigating the bug"));
        // Direct derivation also works via the session-rooted helper.
        assert_eq!(
            derive_task_for_session(tasks.path(), "foreign-1").as_deref(),
            Some("Investigating the bug")
        );
    }

    /// Scenario: Context bridge fallback.
    /// Context % comes from the `$TMPDIR/claude-ctx-<id>.json` bridge: `used_pct`
    /// verbatim when present, else derived from `remaining_percentage`. A missing
    /// bridge leaves context null while the task still surfaces.
    #[test]
    fn context_bridge_fallback() {
        let (tasks, tmp) = fake_foreign("foreign-1");
        let list = compute_foreign_sessions(tasks.path(), tmp.path(), &HashSet::new());
        let f = &list[0];
        assert_eq!(f.context_pct, Some(37.0), "used_pct read from bridge");
        // ts is the newest of task mtime (2000) and bridge ts (2500).
        assert_eq!(f.ts, Some(2_500));

        // No used_pct -> derive from remaining_percentage (100 - 70 = 30).
        let derived = parse_context_bridge(r#"{"remaining_percentage":70.0,"timestamp":9}"#)
            .expect("valid json parses");
        assert_eq!(derived.used_pct, Some(30.0));
        assert_eq!(derived.remaining_percentage, Some(70.0));
        assert_eq!(derived.ts, Some(9));

        // A foreign session with NO bridge file -> null context, task still set.
        let nob = TempDir::new("nobridge-tasks");
        let nobtmp = TempDir::new("nobridge-tmp");
        let sdir = nob.path().join("foreign-2");
        std::fs::create_dir_all(&sdir).unwrap();
        write_with_mtime(
            &sdir,
            "1.json",
            r#"{"id":"1","status":"in_progress","subject":"No bridge here"}"#,
            3_000,
        );
        let list2 = compute_foreign_sessions(nob.path(), nobtmp.path(), &HashSet::new());
        assert_eq!(list2[0].task.as_deref(), Some("No bridge here"));
        assert_eq!(list2[0].context_pct, None, "no bridge -> null context");
        assert_eq!(list2[0].ts, Some(3_000), "heartbeat from task mtime alone");
    }

    /// Scenario: Missing todos directory is not required.
    /// Task derivation reads ONLY `~/.claude/tasks/` and never depends on
    /// `~/.claude/todos/` (absent on CC 2.1.158): derivation succeeds with no
    /// todos dir present anywhere.
    #[test]
    fn missing_todos_directory_is_not_required() {
        let (tasks, tmp) = fake_foreign("foreign-1");
        // No todos/ dir is created anywhere in the fixture.
        assert!(!tasks.path().join("..").join("todos").exists());
        let list = compute_foreign_sessions(tasks.path(), tmp.path(), &HashSet::new());
        assert_eq!(
            list[0].task.as_deref(),
            Some("Investigating the bug"),
            "task derives from tasks/ alone, no todos/ needed"
        );
    }

    /// Umbrella for the REQUIREMENT "Direct-Watch Fallback For Foreign Sessions":
    /// parse a fake tasks dir + bridge end-to-end into one composed ForeignSession.
    #[test]
    fn direct_watch_fallback_for_foreign_sessions() {
        let (tasks, tmp) = fake_foreign("foreign-1");
        let list = compute_foreign_sessions(tasks.path(), tmp.path(), &HashSet::new());
        assert_eq!(list.len(), 1);
        let f = &list[0];
        assert_eq!(f.session_id, "foreign-1");
        assert_eq!(f.task.as_deref(), Some("Investigating the bug"));
        assert_eq!(f.context_pct, Some(37.0));
        assert_eq!(f.ts, Some(2_500));
    }

    // ----- Derive Live Versus Idle From Snapshot Heartbeat --------------------

    /// Scenario: Fresh ts is live.
    /// A ts within the staleness threshold of "now" is live (including exactly at
    /// the boundary and a future ts from clock skew).
    #[test]
    fn fresh_ts_is_live() {
        let now = 1_000_000i64;
        let thresh = LIVENESS_THRESHOLD; // 10s
        assert!(is_live(Some(now), now, thresh), "now is live");
        assert!(
            is_live(Some(now - 5), now, thresh),
            "5s old within 10s -> live"
        );
        assert!(
            is_live(Some(now - 10), now, thresh),
            "exactly at threshold -> live"
        );
        assert!(is_live(Some(now + 5), now, thresh), "future ts -> live");
    }

    /// Scenario: Stale ts is idle.
    /// A ts older than the staleness threshold is idle, as is an absent ts (no
    /// heartbeat at all).
    #[test]
    fn stale_ts_is_idle() {
        let now = 1_000_000i64;
        let thresh = LIVENESS_THRESHOLD; // 10s
        assert!(!is_live(Some(now - 11), now, thresh), "11s old -> idle");
        assert!(
            !is_live(Some(now - 3_600), now, thresh),
            "an hour old -> idle"
        );
        assert!(!is_live(None, now, thresh), "absent ts -> idle");
    }

    /// Umbrella for the REQUIREMENT "Derive Live Versus Idle From Snapshot
    /// Heartbeat": fresh -> live, stale/absent -> idle, in one place.
    #[test]
    fn derive_live_versus_idle_from_snapshot_heartbeat() {
        let now = 1_000_000i64;
        let thresh = LIVENESS_THRESHOLD;
        assert!(is_live(Some(now - 3), now, thresh));
        assert!(!is_live(Some(now - 30), now, thresh));
        assert!(!is_live(None, now, thresh));
    }

    // ----- Context bridge parse: malformed + missing fields -------------------

    /// A malformed bridge file returns None (not a panic); a valid object with no
    /// usable percentage fields parses with `used_pct: None`.
    #[test]
    fn context_bridge_parse_is_tolerant() {
        assert!(parse_context_bridge("{not json").is_none());
        let empty = parse_context_bridge(r#"{"session_id":"x"}"#).expect("valid object");
        assert_eq!(empty.used_pct, None);
        assert_eq!(empty.remaining_percentage, None);
        assert_eq!(empty.ts, None);
    }

    /// `derive_task_for_session` rejects unsafe session ids and reads the
    /// `<base>/<id>` subdir for safe ones.
    #[test]
    fn derive_task_for_session_guards_and_resolves() {
        let tmp = TempDir::new("for-session");
        let base = tmp.path();
        let sdir = base.join("sess-x");
        std::fs::create_dir_all(&sdir).unwrap();
        write_with_mtime(
            &sdir,
            "1.json",
            r#"{"status":"in_progress","activeForm":"Safe task"}"#,
            1_000,
        );
        assert_eq!(
            derive_task_for_session(base, "sess-x").as_deref(),
            Some("Safe task")
        );
        // Path-separator / traversal ids are rejected.
        assert_eq!(derive_task_for_session(base, "../etc"), None);
        assert_eq!(derive_task_for_session(base, "a/b"), None);
        assert_eq!(derive_task_for_session(base, ""), None);
    }

    /// The event-path relevance filter only triggers a recompute for real
    /// foreign-session sources: a `*.json` under the tasks base, or a
    /// `claude-ctx-*.json` under the tmp/bridge dir. Everything else is skipped.
    #[test]
    fn relevant_event_path_filters_noise() {
        let tasks = vec![PathBuf::from("/base/tasks")];
        let tmp = vec![PathBuf::from("/base/tmp")];
        let t = || Path::new("/base/tasks");
        let m = || Path::new("/base/tmp");

        // Task entries under the tasks base: relevant only when *.json.
        assert!(is_relevant_event_path(
            &t().join("sess-a").join("1.json"),
            &tasks,
            &tmp
        ));
        assert!(!is_relevant_event_path(
            &t().join("sess-a").join("1.txt"),
            &tasks,
            &tmp
        ));
        // The session dir itself (no extension) is not a json entry -> skipped.
        assert!(!is_relevant_event_path(&t().join("sess-a"), &tasks, &tmp));

        // Bridge files under the tmp dir: relevant only when claude-ctx-*.json.
        assert!(is_relevant_event_path(
            &m().join("claude-ctx-sess-a.json"),
            &tasks,
            &tmp
        ));
        // A dot-prefixed half-written tmp sibling -> not json -> skipped.
        assert!(!is_relevant_event_path(
            &m().join(".claude-ctx-sess-a.123.tmp"),
            &tasks,
            &tmp
        ));
        // Some other json in the tmp dir (not a bridge file) -> skipped.
        assert!(!is_relevant_event_path(
            &m().join("something-else.json"),
            &tasks,
            &tmp
        ));

        // A path under neither root is always irrelevant.
        assert!(!is_relevant_event_path(
            Path::new("/elsewhere/x.json"),
            &tasks,
            &tmp
        ));

        // Multiple prefixes (raw + canonical) both match.
        let tasks_multi = vec![
            PathBuf::from("/var/t/tasks"),
            PathBuf::from("/private/var/t/tasks"),
        ];
        assert!(is_relevant_event_path(
            Path::new("/private/var/t/tasks/sess/1.json"),
            &tasks_multi,
            &tmp
        ));
    }

    /// End-to-end (headless): the foreign watcher recomputes + emits the filtered
    /// list when a task file appears under the watched base, excluding app
    /// sessions. Exercises the real notify backend (the app-level live wiring is
    /// the MANUAL aspect; this covers the parsing/filter integration headlessly).
    #[test]
    fn foreign_watcher_emits_on_change() {
        let tasks = TempDir::new("watch-tasks");
        let tmp = TempDir::new("watch-tmp");
        let (tx, rx) = mpsc::channel::<Vec<ForeignSession>>();
        let tx = Arc::new(tx);
        // App owns "mine"; "theirs" is foreign.
        let app: AppSessions = Arc::new(Mutex::new(["mine".to_string()].into_iter().collect()));
        let watcher = start_foreign_watcher(tasks.path(), tmp.path(), app, move |list| {
            let _ = tx.send(list);
        })
        .expect("watcher starts");
        assert_eq!(watcher.tasks_base(), tasks.path());

        // Create a foreign session's task dir + entry under the watched base.
        let sdir = tasks.path().join("theirs");
        std::fs::create_dir_all(&sdir).unwrap();
        std::fs::write(
            sdir.join("1.json"),
            r#"{"status":"in_progress","activeForm":"Foreign work"}"#,
        )
        .unwrap();

        // The recomputed list arrives, containing only the foreign session.
        let got = loop {
            let list = rx
                .recv_timeout(Duration::from_secs(5))
                .expect("foreign list must be pushed");
            // Some early events can fire before the file content lands; wait for
            // the one that has our session.
            if list.iter().any(|f| f.session_id == "theirs") {
                break list;
            }
        };
        assert!(
            got.iter().all(|f| f.session_id != "mine"),
            "app session must be excluded"
        );
        let f = got
            .iter()
            .find(|f| f.session_id == "theirs")
            .expect("foreign session present");
        assert_eq!(f.task.as_deref(), Some("Foreign work"));

        drop(watcher); // stops the watch cleanly.
    }
}
