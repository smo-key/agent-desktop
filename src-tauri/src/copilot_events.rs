//! Copilot session observability (`copilot-observability` capability).
//!
//! GitHub Copilot CLI has no hooks and no statusline; instead every session it
//! runs appends typed JSON events to
//! `~/.copilot/session-state/<session-id>/events.jsonl` (shapes verified against
//! CLI 1.0.80 — see the change's design.md S1 and the checked-in fixture
//! `testdata/copilot-events-fixture.jsonl`). Because the app spawns copilot with
//! an APP-MINTED `--session-id <uuid>`, the session dir is located directly by
//! that uuid — no cwd-encoding hunt like the Claude transcript reader.
//!
//! This module supplies three PURE translations from those events plus a tailer:
//!
//!   1. [`Translator::translate`] — one copilot event → the app's normalized
//!      [`AgentEvent`] vocabulary (`UserPromptSubmit`/`PreToolUse`/`PostToolUse`
//!      /`Stop`/`SubagentStop`/`SessionEnd`), so copilot panes feed the SAME
//!      ring/sink/timeline/status pipeline as claude hooks (activity-events:
//!      Backend-specific sources feed one event pipeline).
//!   2. [`activity_from_events`] — the events → an [`Activity`] (summary, recent
//!      messages, user hash/count, pending question, last ts) so `activity_for`
//!      serves copilot panes through the same command. `context_pct` stays
//!      `None` — copilot reports no context-window usage (declared degradation).
//!   3. [`subagents_from_events`] — `subagent.started`/`.completed` → the
//!      [`Subagent`] rows the overview nests under the parent agent.
//!
//! Parsing is VERSION-TOLERANT throughout: unknown event types are skipped,
//! every field is optional, and a malformed line never fails the batch — the
//! same posture `task.rs` takes toward Claude Code versions. The tailer reads
//! only appended bytes (offset per session) and re-reads from 0 on truncation.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};

use crate::activity::{parse_iso_millis, Activity};
use crate::events::{AgentEvent, EventState};
use crate::subagents::Subagent;

/// Max bytes read from the tail of an events file for a one-shot activity read.
/// Matches the transcript reader's bound — enough for the recent turn history.
const ACTIVITY_TAIL_BYTES: u64 = 256 * 1024;

/// Poll fallback interval for the tailer thread: the notify watcher is the fast
/// path, this only bounds staleness if fs events are dropped.
const POLL_INTERVAL: Duration = Duration::from_secs(3);

/// `~/.copilot/session-state`, from the platform home. `None` when home is unset.
pub fn session_state_base() -> Option<PathBuf> {
    let home = crate::shell_path::home_dir();
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home).join(".copilot").join("session-state"))
}

/// The events file for one session, or `None` for an id that is not a safe single
/// path component (separator/`..` smuggling never escapes the base dir).
pub fn events_path(base: &Path, session_id: &str) -> Option<PathBuf> {
    if session_id.is_empty()
        || session_id.contains(['/', '\\'])
        || session_id == "."
        || session_id == ".."
    {
        return None;
    }
    Some(base.join(session_id).join("events.jsonl"))
}

// ---------------------------------------------------------------------------
// Small field helpers (all tolerant: absent/mistyped -> None).
// ---------------------------------------------------------------------------

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn data<'a>(v: &'a Value) -> Option<&'a Value> {
    v.get("data")
}

/// Event time in unix millis from the envelope `timestamp`, or `None`.
fn event_ts(v: &Value) -> Option<i64> {
    str_field(v, "timestamp").and_then(parse_iso_millis)
}

/// Whether the event happened INSIDE a subagent (nested tool call / subagent
/// assistant turn / subagent-injected user prompt). Those stay off the parent's
/// user-facing message surfaces.
fn is_subagent_context(d: &Value) -> bool {
    d.get("parentToolCallId").is_some_and(|p| !p.is_null())
        || d.get("source").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

/// Collapse whitespace and clip to `max` chars (char-safe), mirroring the
/// transcript reader's compact one-line summaries.
fn clip(text: &str, max: usize) -> String {
    let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        collapsed
    } else {
        let head: String = collapsed.chars().take(max).collect();
        format!("{head}…")
    }
}

/// A short `tool:key-input` activity label from a tool's `arguments`, mirroring
/// the claude event hook's summaries (`Bash:npm test`). Falls back to the bare
/// tool name when no recognizable text argument is present.
fn tool_summary(tool: &str, args: Option<&Value>) -> String {
    let head = args.and_then(|a| {
        for key in ["command", "description", "prompt", "question", "name", "path"] {
            if let Some(s) = a.get(key).and_then(Value::as_str) {
                if !s.trim().is_empty() {
                    return Some(clip(s, 60));
                }
            }
        }
        None
    });
    match head {
        Some(h) => format!("{tool}:{h}"),
        None => tool.to_string(),
    }
}

/// Best-effort structured question payload for an `ask_user` tool start, shaped
/// like the claude `AskUserQuestion` payload the frontend already renders:
/// `{questions:[{header, question, multiSelect, options:[{label,description}]}]}`.
/// The exact copilot argument shape is unverified (design S3) — every field is
/// probed tolerantly and a text-only fallback still surfaces the alert.
fn ask_user_question(args: Option<&Value>) -> Value {
    let text = args
        .and_then(|a| {
            for key in ["question", "prompt", "message", "text"] {
                if let Some(s) = a.get(key).and_then(Value::as_str) {
                    if !s.trim().is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
            None
        })
        .unwrap_or_else(|| "The agent has a question".to_string());
    let options: Vec<Value> = args
        .and_then(|a| {
            for key in ["choices", "options"] {
                if let Some(list) = a.get(key).and_then(Value::as_array) {
                    let opts: Vec<Value> = list
                        .iter()
                        .filter_map(|o| {
                            if let Some(s) = o.as_str() {
                                Some(json!({ "label": s }))
                            } else if let Some(label) =
                                o.get("label").and_then(Value::as_str)
                            {
                                let mut opt = json!({ "label": label });
                                if let Some(d) = o.get("description").and_then(Value::as_str) {
                                    opt["description"] = json!(d);
                                }
                                Some(opt)
                            } else {
                                None
                            }
                        })
                        .collect();
                    if !opts.is_empty() {
                        return Some(opts);
                    }
                }
            }
            None
        })
        .unwrap_or_default();
    json!({
        "questions": [{
            "header": "Question",
            "question": text,
            "multiSelect": false,
            "options": options
        }]
    })
}

// ---------------------------------------------------------------------------
// Event translation (copilot event -> AgentEvent).
// ---------------------------------------------------------------------------

/// Stateful translator: `tool.execution_complete` events carry only a
/// `toolCallId`, so the tool name is remembered from the matching start.
#[derive(Default)]
pub struct Translator {
    tool_names: HashMap<String, String>,
}

impl Translator {
    /// Translate one copilot event into the app's normalized event, or `None`
    /// for event types with no analog (turn_start, model_change, system noise).
    pub fn translate(
        &mut self,
        v: &Value,
        pane_id: &str,
        session_id: &str,
    ) -> Option<AgentEvent> {
        let kind = str_field(v, "type")?;
        let d = data(v)?;
        let ts = event_ts(v).unwrap_or(0);
        let base = |name: &str| AgentEvent {
            pane_id: pane_id.to_string(),
            session_id: session_id.to_string(),
            hook_event_name: name.to_string(),
            ts,
            tool_name: None,
            summary: None,
            question: None,
            notification: None,
            reason: None,
        };
        match kind {
            "user.message" => {
                // Subagent-injected prompts (marked by `source`) are not the
                // user speaking — they must not start a "user turn".
                if is_subagent_context(d) {
                    return None;
                }
                Some(base("UserPromptSubmit"))
            }
            "assistant.turn_end" => Some(base("Stop")),
            "session.shutdown" => {
                let mut ev = base("SessionEnd");
                ev.reason = Some(
                    str_field(d, "shutdownType")
                        .unwrap_or("other")
                        .to_string(),
                );
                Some(ev)
            }
            "tool.execution_start" => {
                let tool = str_field(d, "toolName")?.to_string();
                if let Some(id) = str_field(d, "toolCallId") {
                    self.tool_names.insert(id.to_string(), tool.clone());
                }
                let args = d.get("arguments");
                let mut ev = base("PreToolUse");
                ev.summary = Some(tool_summary(&tool, args));
                if tool == "ask_user" {
                    ev.question = Some(ask_user_question(args));
                }
                ev.tool_name = Some(tool);
                Some(ev)
            }
            "tool.execution_complete" => {
                let mut ev = base("PostToolUse");
                ev.tool_name = str_field(d, "toolCallId")
                    .and_then(|id| self.tool_names.remove(id));
                Some(ev)
            }
            "subagent.completed" => Some(base("SubagentStop")),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Activity derivation (events -> Activity).
// ---------------------------------------------------------------------------

/// The user's prose messages (main session only, oldest first) — the title
/// generator's input. `content` is the verbatim typed text (the CLI's context
/// scaffolding lives in `transformedContent`, which is deliberately ignored).
pub fn user_messages(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter(|v| str_field(v, "type") == Some("user.message"))
        .filter_map(data)
        .filter(|d| !is_subagent_context(d))
        .filter_map(|d| str_field(d, "content"))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// The MAIN session's assistant prose messages (oldest first), skipping empty
/// tool-call-only turns and subagent-context messages.
pub fn assistant_messages(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter(|v| str_field(v, "type") == Some("assistant.message"))
        .filter_map(data)
        .filter(|d| !is_subagent_context(d))
        .filter_map(|d| str_field(d, "content"))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// The current MAIN-session model id: the last `session.model_change` or
/// non-subagent `assistant.message` model, whichever came later in the log.
pub fn current_model(events: &[Value]) -> Option<String> {
    let mut model = None;
    for v in events {
        match str_field(v, "type") {
            Some("session.model_change") => {
                if let Some(m) = data(v).and_then(|d| str_field(d, "newModel")) {
                    model = Some(m.to_string());
                }
            }
            Some("assistant.message") => {
                if let Some(d) = data(v) {
                    if !is_subagent_context(d) {
                        if let Some(m) = str_field(d, "model") {
                            model = Some(m.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    model
}

/// A stable, cheap hash over the user's messages — change-detection only (the
/// frontend regenerates the title when it changes), never parsed.
fn hash_messages(msgs: &[String]) -> Option<String> {
    if msgs.is_empty() {
        return None;
    }
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for m in msgs {
        m.hash(&mut h);
    }
    Some(format!("{:x}", h.finish()))
}

/// The pending ask-user question: an `ask_user` `tool.execution_start` with no
/// matching `tool.execution_complete` yet. Returns its compact text.
fn pending_question(events: &[Value]) -> Option<String> {
    let mut pending: Option<(String, String)> = None; // (toolCallId, text)
    for v in events {
        let Some(d) = data(v) else { continue };
        match str_field(v, "type") {
            Some("tool.execution_start") if str_field(d, "toolName") == Some("ask_user") => {
                let id = str_field(d, "toolCallId").unwrap_or("").to_string();
                let q = ask_user_question(d.get("arguments"));
                let text = q["questions"][0]["question"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                pending = Some((id, text));
            }
            Some("tool.execution_complete") => {
                if let (Some((pid, _)), Some(cid)) = (&pending, str_field(d, "toolCallId")) {
                    if pid == cid {
                        pending = None;
                    }
                }
            }
            _ => {}
        }
    }
    pending.map(|(_, text)| text)
}

/// Derive the pane's [`Activity`] from its session events. `context_pct` is
/// always `None` (copilot exposes no context-window usage — the card renders
/// without a context bar, per the usage-dashboard degradation).
pub fn activity_from_events(events: &[Value]) -> Activity {
    let asst = assistant_messages(events);
    let users = user_messages(events);
    let last_ts = events.iter().rev().find_map(event_ts).map(|ms| ms / 1000);
    let recent: Vec<String> = asst
        .iter()
        .rev()
        .take(3)
        .rev()
        .map(|m| clip(m, 400))
        .collect();
    Activity {
        summary: asst.last().map(|m| clip(m, 400)),
        question: pending_question(events),
        questions: None,
        context_pct: None,
        messages: if recent.is_empty() { None } else { Some(recent) },
        user_hash: hash_messages(&users),
        user_msg_count: Some(users.len()),
        last_msg_ts: last_ts,
    }
}

// ---------------------------------------------------------------------------
// Subagent rows (events -> Vec<Subagent>).
// ---------------------------------------------------------------------------

/// Derive the session's subagent rows from `subagent.started` / `.completed`
/// pairs, keyed by the spawning `toolCallId`. A started-without-completed row is
/// `running`; a completed row is `done` with its recorded token total.
pub fn subagents_from_events(session_id: &str, events: &[Value]) -> Vec<Subagent> {
    // Insertion-ordered map: toolCallId -> row.
    let mut order: Vec<String> = Vec::new();
    let mut rows: HashMap<String, Subagent> = HashMap::new();
    for v in events {
        let Some(d) = data(v) else { continue };
        match str_field(v, "type") {
            Some("subagent.started") => {
                let Some(id) = str_field(d, "toolCallId") else { continue };
                let label = str_field(d, "agentDisplayName")
                    .or_else(|| str_field(d, "agentName"))
                    .map(str::to_string);
                let row = Subagent {
                    id: id.to_string(),
                    label,
                    status: Some("running".to_string()),
                    model: str_field(d, "model").map(str::to_string),
                    usage: None,
                    parent_session: String::new(),
                    workflow_id: None,
                    phase_title: None,
                    phase_index: None,
                    started_at: event_ts(v),
                    duration_ms: None,
                };
                if !rows.contains_key(id) {
                    order.push(id.to_string());
                }
                rows.insert(id.to_string(), row);
            }
            Some("subagent.completed") => {
                let Some(id) = str_field(d, "toolCallId") else { continue };
                let tokens = d.get("totalTokens").and_then(Value::as_u64);
                let entry = rows.entry(id.to_string()).or_insert_with(|| {
                    order.push(id.to_string());
                    Subagent {
                        id: id.to_string(),
                        label: str_field(d, "agentDisplayName")
                            .or_else(|| str_field(d, "agentName"))
                            .map(str::to_string),
                        status: None,
                        model: str_field(d, "model").map(str::to_string),
                        usage: None,
                        parent_session: String::new(),
                        workflow_id: None,
                        phase_title: None,
                        phase_index: None,
                        started_at: None,
                        duration_ms: None,
                    }
                });
                entry.status = Some("done".to_string());
                if entry.model.is_none() {
                    entry.model = str_field(d, "model").map(str::to_string);
                }
                entry.usage = tokens.map(|t| crate::subagents::SubagentUsage {
                    cost: None,
                    tokens: Some(t),
                    context_pct: None,
                });
                entry.duration_ms = d.get("durationMs").and_then(Value::as_i64);
            }
            _ => {}
        }
    }
    order
        .into_iter()
        .filter_map(|id| rows.remove(&id))
        .map(|mut r| {
            r.parent_session = session_id.to_string();
            r
        })
        .collect()
}

// ---------------------------------------------------------------------------
// File reading.
// ---------------------------------------------------------------------------

/// Parse a chunk of JSONL bytes tolerantly: each well-formed line becomes a
/// `Value`; malformed lines (including a truncated first line after a mid-file
/// seek) are skipped.
fn parse_jsonl(bytes: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
        .collect()
}

/// One-shot bounded read of a session's events (the TAIL window) for activity /
/// subagent derivation. Missing/unreadable file -> empty (the pane degrades to
/// a plain terminal, never an error).
pub fn read_session_events(path: &Path) -> Vec<Value> {
    let Ok(mut f) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len > ACTIVITY_TAIL_BYTES {
        let _ = f.seek(SeekFrom::Start(len - ACTIVITY_TAIL_BYTES));
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    parse_jsonl(&buf)
}

// ---------------------------------------------------------------------------
// The tailer.
// ---------------------------------------------------------------------------

/// One watched copilot pane: its session id, the translator carrying tool-name
/// state, and the byte offset already consumed from its events file.
struct WatchedPane {
    session_id: String,
    translator: Translator,
    offset: u64,
}

/// Shared registry of watched panes, keyed by pane id.
#[derive(Default)]
pub struct CopilotWatchState {
    panes: Mutex<HashMap<String, WatchedPane>>,
}

impl CopilotWatchState {
    /// Register (or re-register) a pane→session watch. The offset starts at 0 so
    /// a resume replays the whole (bounded) log — the ring/sink de-dup by ts is
    /// not needed because registration happens once per spawn and the durable
    /// sink is keyed by session id (re-appends are tolerated by the timeline).
    pub fn watch(&self, pane_id: String, session_id: String) {
        let mut g = self.panes.lock().unwrap();
        g.insert(
            pane_id,
            WatchedPane {
                session_id,
                translator: Translator::default(),
                offset: 0,
            },
        );
    }

    /// Drop a pane's watch (pane closed / component destroyed).
    pub fn unwatch(&self, pane_id: &str) {
        self.panes.lock().unwrap().remove(pane_id);
    }
}

/// The running tailer: a notify watcher over the session-state base plus a slow
/// poll fallback. Dropping it stops the thread at the next tick.
pub struct CopilotTailer {
    _watcher: Option<RecommendedWatcher>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

impl Drop for CopilotTailer {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Drain new bytes for every watched pane: translate fresh events into the ring/
/// sink via `state`, hand each to `on_event`, and report the latest model per
/// pane for snapshot upkeep. Extracted for testability.
fn drain<F: Fn(AgentEvent)>(
    base: &Path,
    watch: &CopilotWatchState,
    events: &EventState,
    on_event: &F,
) -> Vec<(String, String, Option<String>)> {
    let mut snapshots = Vec::new();
    let mut g = watch.panes.lock().unwrap();
    for (pane_id, wp) in g.iter_mut() {
        let Some(path) = events_path(base, &wp.session_id) else {
            continue;
        };
        let Ok(mut f) = std::fs::File::open(&path) else {
            continue;
        };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < wp.offset {
            // Truncated/rewritten: start over.
            wp.offset = 0;
        }
        if len == wp.offset {
            continue;
        }
        if f.seek(SeekFrom::Start(wp.offset)).is_err() {
            continue;
        }
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_err() {
            continue;
        }
        // Only consume up to the last complete line; a partially-flushed tail
        // line is left for the next drain.
        let consumed = match buf.iter().rposition(|&b| b == b'\n') {
            Some(pos) => pos + 1,
            None => continue,
        };
        wp.offset += consumed as u64;
        let values = parse_jsonl(&buf[..consumed]);
        let mut model: Option<String> = None;
        for v in &values {
            if let Some(m) = current_model(std::slice::from_ref(v)) {
                model = Some(m);
            }
            if let Some(ev) = wp.translator.translate(v, pane_id, &wp.session_id) {
                events.record(&ev);
                on_event(ev);
            }
        }
        if model.is_some() {
            snapshots.push((pane_id.clone(), wp.session_id.clone(), model));
        }
    }
    snapshots
}

/// Write/refresh the minimal usage snapshot for a copilot pane (model id only —
/// no context %, no rate limits: those fields stay absent by design). Atomic
/// temp+rename so the snapshot watcher never reads a partial file.
fn write_snapshot(snapshot_dir: &Path, pane_id: &str, session_id: &str, model_id: &str) {
    if pane_id.is_empty() || pane_id.contains(['/', '\\']) {
        return;
    }
    let body = json!({
        "pane_id": pane_id,
        "session_id": session_id,
        "model_id": model_id,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    });
    let _ = std::fs::create_dir_all(snapshot_dir);
    let tmp = snapshot_dir.join(format!("{pane_id}.json.tmp"));
    let dst = snapshot_dir.join(format!("{pane_id}.json"));
    if std::fs::write(&tmp, body.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, &dst);
    }
}

/// Start the tailer over `base` (`~/.copilot/session-state`). New events for
/// watched panes are recorded into `events` (ring + durable sink) and handed to
/// `on_event` (the production caller emits `overview://event`); model changes
/// refresh the pane's snapshot under `snapshot_dir` (picked up by the existing
/// snapshot watcher → footer model pill).
pub fn start_copilot_tailer<F>(
    base: PathBuf,
    watch: Arc<CopilotWatchState>,
    events: Arc<EventState>,
    snapshot_dir: PathBuf,
    on_event: F,
) -> CopilotTailer
where
    F: Fn(AgentEvent) + Send + 'static,
{
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<()>();

    // Notify watcher: any change under the session-state tree pokes the drain
    // thread. Best-effort — the poll fallback covers a failed watch (or a base
    // dir that does not exist yet because copilot has never run).
    let watcher = {
        let tx = tx.clone();
        let mut w: Option<RecommendedWatcher> = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if res.is_ok() {
                    let _ = tx.send(());
                }
            },
        )
        .ok();
        if let Some(watcher) = w.as_mut() {
            let _ = std::fs::create_dir_all(&base);
            if watcher.watch(&base, RecursiveMode::Recursive).is_err() {
                w = None;
            }
        }
        w
    };

    {
        let stop = stop.clone();
        std::thread::spawn(move || loop {
            // Wake on a fs event or the poll interval, whichever first.
            let _ = rx.recv_timeout(POLL_INTERVAL);
            if stop.load(std::sync::atomic::Ordering::Relaxed) {
                return;
            }
            for (pane_id, session_id, model) in
                drain(&base, &watch, &events, &on_event)
            {
                if let Some(m) = model {
                    write_snapshot(&snapshot_dir, &pane_id, &session_id, &m);
                }
            }
        });
    }

    CopilotTailer {
        _watcher: watcher,
        stop,
    }
}

// ---------------------------------------------------------------------------
// Tests — the fixture is a REAL 1.0.80 events.jsonl (sanitized), so these lock
// the translation against the verified wire shapes. Test fn names match the
// spec's `#### Scenario:` titles for the coverage gate.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<Value> {
        let raw = include_str!("../testdata/copilot-events-fixture.jsonl");
        parse_jsonl(raw.as_bytes())
    }

    fn translate_all(events: &[Value]) -> Vec<AgentEvent> {
        let mut t = Translator::default();
        events
            .iter()
            .filter_map(|v| t.translate(v, "p1", "s1"))
            .collect()
    }

    #[test]
    fn session_directory_found_by_uuid() {
        let base = Path::new("/base");
        assert_eq!(
            events_path(base, "abc-123").unwrap(),
            Path::new("/base/abc-123/events.jsonl")
        );
        assert!(events_path(base, "../etc").is_none());
        assert!(events_path(base, "a/b").is_none());
        assert!(events_path(base, "").is_none());
    }

    #[test]
    fn unknown_events_are_skipped() {
        let mut t = Translator::default();
        let noise = serde_json::json!({"type":"future.event","data":{"x":1},"timestamp":"2026-08-17T22:40:35.924Z"});
        assert!(t.translate(&noise, "p1", "s1").is_none());
        let no_type = serde_json::json!({"data":{}});
        assert!(t.translate(&no_type, "p1", "s1").is_none());
        // ...and known events around noise still translate (whole fixture).
        assert!(!translate_all(&fixture()).is_empty());
    }

    #[test]
    fn turn_in_flight_reads_working() {
        // The fixture's user prompt begins a turn: a UserPromptSubmit is emitted
        // (the status derivation's "turn started" signal), and the tool start
        // arrives as PreToolUse with a summary — the same inputs a working
        // claude pane produces.
        let evs = translate_all(&fixture());
        let first = &evs[0];
        assert_eq!(first.hook_event_name, "UserPromptSubmit");
        let pre = evs
            .iter()
            .find(|e| e.hook_event_name == "PreToolUse")
            .unwrap();
        assert_eq!(pre.tool_name.as_deref(), Some("bash"));
        assert_eq!(pre.summary.as_deref(), Some("bash:echo spike-tool-call"));
    }

    #[test]
    fn turn_end_returns_to_idle() {
        let evs = translate_all(&fixture());
        // Every turn_end maps to Stop; the session shutdown maps to SessionEnd.
        assert!(evs.iter().any(|e| e.hook_event_name == "Stop"));
        let end = evs
            .iter()
            .find(|e| e.hook_event_name == "SessionEnd")
            .unwrap();
        assert_eq!(end.reason.as_deref(), Some("routine"));
        // Order: the last Stop precedes SessionEnd.
        let last = evs.last().unwrap();
        assert_eq!(last.hook_event_name, "SessionEnd");
    }

    #[test]
    fn post_tool_use_carries_the_started_tool_name() {
        let evs = translate_all(&fixture());
        let post = evs
            .iter()
            .find(|e| e.hook_event_name == "PostToolUse")
            .unwrap();
        assert!(post.tool_name.is_some());
    }

    #[test]
    fn ask_user_surfaces_as_needs_input() {
        // Synthesized ask_user start (shape per design S3): surfaces a PreToolUse
        // carrying the structured question payload, and the activity derivation
        // reports it pending until the matching complete arrives.
        let start = serde_json::json!({
            "type": "tool.execution_start",
            "timestamp": "2026-08-17T22:41:00.000Z",
            "data": {
                "toolCallId": "t-q1",
                "toolName": "ask_user",
                "arguments": { "question": "Red or blue?", "choices": ["red", "blue"] }
            }
        });
        let mut t = Translator::default();
        let ev = t.translate(&start, "p1", "s1").unwrap();
        assert_eq!(ev.hook_event_name, "PreToolUse");
        let q = ev.question.unwrap();
        assert_eq!(q["questions"][0]["question"], "Red or blue?");
        assert_eq!(q["questions"][0]["options"][0]["label"], "red");

        let mut events = fixture();
        events.push(start.clone());
        let act = activity_from_events(&events);
        assert_eq!(act.question.as_deref(), Some("Red or blue?"));

        // Completing the call clears the pending question.
        events.push(serde_json::json!({
            "type": "tool.execution_complete",
            "timestamp": "2026-08-17T22:41:10.000Z",
            "data": { "toolCallId": "t-q1" }
        }));
        assert!(activity_from_events(&events).question.is_none());
    }

    #[test]
    fn activity_derives_from_the_main_session_only() {
        let act = activity_from_events(&fixture());
        // Summary is the LAST main-session assistant message — never the
        // subagent's ("The command executed successfully…").
        assert!(act.summary.unwrap().starts_with("Both done"));
        // One real user message (the subagent-injected prompt has `source`).
        assert_eq!(act.user_msg_count, Some(1));
        assert!(act.user_hash.is_some());
        // Copilot reports no context usage: absent by design.
        assert!(act.context_pct.is_none());
        assert!(act.last_msg_ts.is_some());
    }

    #[test]
    fn auto_title_from_copilot_transcript() {
        // The title generator's inputs come from the same events: the user's
        // verbatim prose and the main-session assistant replies.
        let users = user_messages(&fixture());
        assert_eq!(users.len(), 1);
        assert!(users[0].starts_with("Run echo spike-tool-call"));
        let asst = assistant_messages(&fixture());
        assert!(!asst.is_empty());
        assert!(asst.iter().all(|m| !m.contains("The command executed")));
    }

    #[test]
    fn copilot_model_reported_for_the_footer() {
        assert_eq!(current_model(&fixture()).as_deref(), Some("claude-sonnet-5"));
    }

    #[test]
    fn subagent_start_surfaces_a_row() {
        let rows = subagents_from_events("s1", &fixture());
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.label.as_deref(), Some("Task Agent"));
        // The fixture's subagent completed, with its recorded token total.
        assert_eq!(r.status.as_deref(), Some("done"));
        assert_eq!(r.model.as_deref(), Some("claude-haiku-4.5"));
        assert_eq!(r.usage.as_ref().unwrap().tokens, Some(32741));

        // A started-without-completed subagent reads running.
        let started_only = vec![serde_json::json!({
            "type": "subagent.started",
            "timestamp": "2026-08-17T22:41:00.000Z",
            "data": { "toolCallId": "t-1", "agentName": "task", "agentDisplayName": "Task Agent", "model": "m" }
        })];
        let rows = subagents_from_events("s1", &started_only);
        assert_eq!(rows[0].status.as_deref(), Some("running"));
    }

    #[test]
    fn missing_session_state_degrades_to_a_plain_pane() {
        // No dir / no file -> empty events -> a default Activity, no error.
        let vals = read_session_events(Path::new("/nonexistent/events.jsonl"));
        assert!(vals.is_empty());
        let act = activity_from_events(&vals);
        assert!(act.summary.is_none());
        assert_eq!(act.user_msg_count, Some(0));
    }

    struct TempDir(PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tempdir(tag: &str) -> TempDir {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ade-cop-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    #[test]
    fn tailer_drain_reads_only_appended_bytes() {
        let tmp = tempdir("drain");
        let base = tmp.0.clone();
        let sdir = base.join("s1");
        std::fs::create_dir_all(&sdir).unwrap();
        let file = sdir.join("events.jsonl");

        let watch = CopilotWatchState::default();
        watch.watch("p1".into(), "s1".into());
        let events = EventState::new(tmp.0.join("sink"));
        let seen = Mutex::new(Vec::<AgentEvent>::new());

        // First drain: one complete line + one partial (no newline) — only the
        // complete line is consumed.
        std::fs::write(
            &file,
            "{\"type\":\"user.message\",\"timestamp\":\"2026-08-17T22:40:37.000Z\",\"data\":{\"content\":\"hi\"}}\n{\"type\":\"assistant.turn_e",
        )
        .unwrap();
        let out = drain(&base, &watch, &events, &|e| seen.lock().unwrap().push(e));
        assert!(out.is_empty());
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert_eq!(seen.lock().unwrap()[0].hook_event_name, "UserPromptSubmit");

        // Completing the partial line delivers exactly the new event.
        let mut f = std::fs::OpenOptions::new().append(true).open(&file).unwrap();
        use std::io::Write;
        f.write_all(b"nd\",\"timestamp\":\"2026-08-17T22:40:39.000Z\",\"data\":{}}\n")
            .unwrap();
        drop(f);
        drain(&base, &watch, &events, &|e| seen.lock().unwrap().push(e));
        let got = seen.lock().unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[1].hook_event_name, "Stop");
        // ...and the ring recorded both under the pane.
        assert_eq!(events.ring_for("p1").len(), 2);
    }
}

#[cfg(test)]
mod pipeline_tests {
    use super::tests_support::*;
    use super::*;

    #[test]
    fn copilot_events_reach_the_timeline() {
        // A translated copilot tool-call event lands in the pane ring AND the
        // durable per-session sink — the same pipeline claude hook events use.
        let tmp = tempdir_at("timeline");
        let events = EventState::new(tmp.0.join("sink"));
        let mut t = Translator::default();
        let v = serde_json::json!({
            "type": "tool.execution_start",
            "timestamp": "2026-08-17T22:41:00.000Z",
            "data": { "toolCallId": "t1", "toolName": "bash",
                      "arguments": { "command": "ls" } }
        });
        let ev = t.translate(&v, "p1", "s1").unwrap();
        events.record(&ev);
        assert_eq!(events.ring_for("p1").len(), 1);
        let sink = events.sink_for("s1");
        assert_eq!(sink.len(), 1);
        assert_eq!(sink[0].summary.as_deref(), Some("bash:ls"));
    }

    #[test]
    fn rehydration_is_backend_agnostic() {
        // The durable sink replays by session id with no backend-specific
        // casing: a claude-hook-shaped event and a copilot-translated event are
        // recovered identically for their respective sessions.
        let tmp = tempdir_at("rehydrate");
        let events = EventState::new(tmp.0.join("sink"));
        let claude_ev: AgentEvent = serde_json::from_str(
            r#"{"paneId":"pc","sessionId":"s-claude","hookEventName":"Stop","ts":5}"#,
        )
        .unwrap();
        events.record(&claude_ev);
        let mut t = Translator::default();
        let cop = serde_json::json!({
            "type": "assistant.turn_end",
            "timestamp": "2026-08-17T22:41:00.000Z",
            "data": {}
        });
        let cop_ev = t.translate(&cop, "pk", "s-copilot").unwrap();
        events.record(&cop_ev);
        assert_eq!(events.sink_for("s-claude").len(), 1);
        let cop_sink = events.sink_for("s-copilot");
        assert_eq!(cop_sink.len(), 1);
        assert_eq!(cop_sink[0].hook_event_name, "Stop");
    }
}

#[cfg(test)]
pub(crate) mod tests_support {
    use std::path::PathBuf;

    pub struct TempDirAt(pub PathBuf);
    impl Drop for TempDirAt {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    pub fn tempdir_at(tag: &str) -> TempDirAt {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ade-copl-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        TempDirAt(dir)
    }
}
