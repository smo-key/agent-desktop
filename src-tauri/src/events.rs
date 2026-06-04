//! Event pipeline for the `activity-events` / `activity-timeline` capabilities.
//!
//! Every app-launched claude session is wired (via the per-session `--settings`
//! hooks, see `resources/event-hook.cjs`) to deliver each hook lifecycle event as
//! one JSON line over the app-hosted Unix-domain socket this module owns. The
//! accept loop parses each line into an [`AgentEvent`] and:
//!   1. appends it to a bounded per-pane in-memory ring (the hot cache the
//!      overview seeds from), and
//!   2. appends it to a durable per-session sink `events/<sessionId>.jsonl` (so
//!      the timeline survives an app restart / `claude --resume`), and
//!   3. hands it to the caller's `on_event` callback (which emits the Tauri
//!      `overview://event` in production, or pushes to a channel in tests).
//!
//! Concurrency matches the rest of the backend (the `notify` snapshot watcher):
//! std threads + `Mutex`, no async runtime. The socket is hosted by the app,
//! which always runs when it spawns claude (and whose PTY children die with it),
//! so a session never outlives the socket — the hook tolerates an absent socket
//! regardless, never blocking a turn.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The Tauri event name each parsed event is emitted on. The frontend event
/// store listens on exactly this name.
pub const EVENT_EVENT: &str = "overview://event";

/// Max events retained per pane in the in-memory ring (the hot cache). Older
/// events stay in the durable sink; this only bounds memory.
const RING_CAP: usize = 500;

/// Retention: durable session logs untouched longer than this are pruned on boot.
const RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Retention: a single session log is truncated (from the head) above this size.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

/// One normalized hook event, mirroring the JSON the event hook emits (camelCase)
/// and re-serialized verbatim to the frontend. Only `paneId`/`hookEventName`/`ts`
/// are structurally required; tool/question/notification fields are present only
/// for the events that carry them. A line missing the required fields fails to
/// parse and is dropped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    /// The frontend pane id (the ring key / roster row); stamped by the hook env.
    pub pane_id: String,
    /// The Claude session id (the durable-sink key); empty when unknown.
    #[serde(default)]
    pub session_id: String,
    /// The hook lifecycle event name (e.g. `PreToolUse`, `Stop`).
    pub hook_event_name: String,
    /// Event time in unix MILLIS (hook-stamped, or receive-stamped on backfill).
    pub ts: i64,
    /// The tool name for Pre/PostToolUse events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// A short activity label for Pre/PostToolUse events (e.g. `Bash:npm test`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// The structured pending-question payload on a `PreToolUse[AskUserQuestion]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<Value>,
    /// The message text on a `Notification` event.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notification: Option<String>,
}

/// Parse one socket payload (the hook writes exactly one newline-terminated JSON
/// object then closes). Returns `None` for anything that isn't a well-formed
/// event, so a malformed line is silently dropped rather than killing the loop.
fn parse_event(raw: &str) -> Option<AgentEvent> {
    let line = raw.trim();
    if line.is_empty() {
        return None;
    }
    let ev: AgentEvent = serde_json::from_str(line).ok()?;
    if ev.pane_id.is_empty() || ev.hook_event_name.is_empty() {
        return None;
    }
    Some(ev)
}

/// A filesystem-safe single path component (no separators / `..`), so a hostile
/// or odd session id can never escape the events dir. Mirrors the guard the
/// transcript reader uses.
fn safe_component(s: &str) -> Option<&str> {
    if s.is_empty() || s.contains(['/', '\\']) || s == "." || s == ".." {
        None
    } else {
        Some(s)
    }
}

/// Shared event state: the per-pane ring (hot cache) and the durable-sink dir.
/// Held in an `Arc` so the accept thread and the `events_for` command share it.
pub struct EventState {
    ring: Mutex<HashMap<String, VecDeque<AgentEvent>>>,
    events_dir: PathBuf,
}

impl EventState {
    /// Create the state rooted at `events_dir` (created if missing).
    pub fn new(events_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&events_dir);
        EventState {
            ring: Mutex::new(HashMap::new()),
            events_dir,
        }
    }

    /// The durable sink path for a session, or `None` for an unsafe/empty id.
    fn sink_path(&self, session_id: &str) -> Option<PathBuf> {
        let sid = safe_component(session_id)?;
        Some(self.events_dir.join(format!("{sid}.jsonl")))
    }

    /// Record an event: push to the pane ring (bounded) and append to the durable
    /// per-session sink. Both are best-effort — a fs error never propagates.
    pub fn record(&self, ev: &AgentEvent) {
        if let Ok(mut ring) = self.ring.lock() {
            let q = ring.entry(ev.pane_id.clone()).or_default();
            q.push_back(ev.clone());
            while q.len() > RING_CAP {
                q.pop_front();
            }
        }
        if let Some(path) = self.sink_path(&ev.session_id) {
            if let Ok(line) = serde_json::to_string(ev) {
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path)
                {
                    let _ = writeln!(f, "{line}");
                }
            }
        }
    }

    /// The retained events for a pane from the hot ring (empty when none).
    pub fn ring_for(&self, pane_id: &str) -> Vec<AgentEvent> {
        self.ring
            .lock()
            .ok()
            .and_then(|r| r.get(pane_id).map(|q| q.iter().cloned().collect()))
            .unwrap_or_default()
    }

    /// The persisted events for a session read from its durable sink (empty when
    /// the file is absent). Malformed lines are skipped.
    pub fn sink_for(&self, session_id: &str) -> Vec<AgentEvent> {
        let Some(path) = self.sink_path(session_id) else {
            return Vec::new();
        };
        let Ok(body) = std::fs::read_to_string(&path) else {
            return Vec::new();
        };
        body.lines().filter_map(parse_event).collect()
    }

    /// Prune the durable sink on boot: remove logs older than [`RETENTION`] and
    /// truncate any single log above [`MAX_LOG_BYTES`] from the head (oldest lines
    /// dropped, newest preserved). Best-effort; never errors.
    pub fn prune(&self) {
        let Ok(entries) = std::fs::read_dir(&self.events_dir) else {
            return;
        };
        let now = SystemTime::now();
        for entry in entries.flatten() {
            let path = entry.path();
            let is_jsonl = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("jsonl"));
            if !is_jsonl {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            // Age-based prune.
            if let Ok(modified) = meta.modified() {
                if now.duration_since(modified).map(|d| d > RETENTION).unwrap_or(false) {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
            }
            // Size-based head-truncation: keep the newest lines within the cap.
            if meta.len() > MAX_LOG_BYTES {
                truncate_head(&path, MAX_LOG_BYTES);
            }
        }
    }
}

/// Rewrite `path` keeping only its trailing lines that fit within `max` bytes
/// (whole lines, newest preserved). Best-effort.
fn truncate_head(path: &Path, max: u64) {
    let Ok(body) = std::fs::read_to_string(path) else {
        return;
    };
    let mut kept: Vec<&str> = Vec::new();
    let mut size: u64 = 0;
    for line in body.lines().rev() {
        let add = line.len() as u64 + 1;
        if size + add > max {
            break;
        }
        size += add;
        kept.push(line);
    }
    kept.reverse();
    let out = if kept.is_empty() {
        String::new()
    } else {
        format!("{}\n", kept.join("\n"))
    };
    let _ = std::fs::write(path, out);
}

/// Owns the listener thread for the event socket. Dropping it removes the socket
/// file; the app holds exactly one in managed state for its lifetime.
pub struct EventServer {
    socket_path: PathBuf,
}

impl Drop for EventServer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// Bind the event socket at `socket_path` (removing any STALE file first so a
/// crash/restart never fails to bind), and spawn the accept thread. Each accepted
/// connection's one line is parsed, recorded into `state` (ring + durable sink),
/// and passed to `on_event`. Malformed lines are dropped. Returns the
/// [`EventServer`] the caller must keep alive.
///
/// `on_event` runs on the accept thread; it must be `Send`. In production it
/// emits the Tauri `overview://event`; in tests it pushes to a channel.
pub fn start_event_server<F>(
    socket_path: &Path,
    state: Arc<EventState>,
    on_event: F,
) -> Result<EventServer, String>
where
    F: Fn(AgentEvent) + Send + 'static,
{
    // A leftover socket file (prior run / crash) makes bind() fail with
    // AddrInUse; unlink it first so a restart always binds cleanly.
    let _ = std::fs::remove_file(socket_path);
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create_dir_all {parent:?}: {e}"))?;
    }
    let listener =
        UnixListener::bind(socket_path).map_err(|e| format!("bind {socket_path:?}: {e}"))?;

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else {
                continue; // accept error: skip this connection, keep serving.
            };
            let mut raw = String::new();
            if stream.read_to_string(&mut raw).is_err() {
                continue;
            }
            let Some(ev) = parse_event(&raw) else {
                continue; // malformed line: drop, keep serving.
            };
            state.record(&ev);
            on_event(ev);
        }
    });

    Ok(EventServer {
        socket_path: socket_path.to_path_buf(),
    })
}

/// Reconstruct a completed-tool timeline for a session that has no durable sink
/// yet (it predates this feature) by parsing `tool_use`/`tool_result` blocks out
/// of its transcript. Each `tool_use` becomes a `PreToolUse` event (with a
/// summary) and each `tool_result` a `PostToolUse` event, in file order. Live-only
/// events (Notification, exact in-flight ordering) are necessarily absent — only
/// what the durable transcript records is recoverable. Best-effort: a missing or
/// malformed transcript yields an empty timeline.
pub fn backfill_from_transcript(transcript: &Path, pane_id: &str, session_id: &str) -> Vec<AgentEvent> {
    let Ok(body) = std::fs::read_to_string(transcript) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in body.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let ts = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(parse_iso_millis)
            .unwrap_or(0);
        let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            continue;
        };
        for block in content {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("tool_use") => {
                    let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    out.push(AgentEvent {
                        pane_id: pane_id.to_string(),
                        session_id: session_id.to_string(),
                        hook_event_name: "PreToolUse".into(),
                        ts,
                        tool_name: Some(name.to_string()),
                        summary: Some(summarize_tool(name, block.get("input"))),
                        question: None,
                        notification: None,
                    });
                }
                Some("tool_result") => {
                    out.push(AgentEvent {
                        pane_id: pane_id.to_string(),
                        session_id: session_id.to_string(),
                        hook_event_name: "PostToolUse".into(),
                        ts,
                        tool_name: None,
                        summary: None,
                        question: None,
                        notification: None,
                    });
                }
                _ => {}
            }
        }
    }
    out
}

/// Best-effort ISO-8601 (e.g. `2026-06-03T12:00:00.000Z`) -> unix millis. Returns
/// `None` for anything it can't parse cheaply (we avoid a chrono dependency, so a
/// non-Z / offset timestamp simply yields `None` and the event keeps ts 0).
fn parse_iso_millis(s: &str) -> Option<i64> {
    // YYYY-MM-DDTHH:MM:SS(.fff)?Z — parse the calendar fields and fold to millis.
    let bytes = s.as_bytes();
    if bytes.len() < 20 || !s.ends_with('Z') {
        return None;
    }
    let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
    let year = num(0, 4)?;
    let month = num(5, 7)?;
    let day = num(8, 10)?;
    let hour = num(11, 13)?;
    let min = num(14, 16)?;
    let sec = num(17, 19)?;
    let millis = if s.len() > 20 && bytes[19] == b'.' {
        let frac: String = s[20..s.len() - 1].chars().take(3).collect();
        let pad = format!("{frac:0<3}");
        pad.parse::<i64>().ok()?
    } else {
        0
    };
    // Days since unix epoch (civil calendar, valid for 1970..).
    let days = days_from_civil(year, month, day);
    Some(((days * 86400 + hour * 3600 + min * 60 + sec) * 1000) + millis)
}

/// Days from 1970-01-01 to the given civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Summarize a transcript `tool_use` block for the backfilled timeline — the Rust
/// mirror of the event hook's `summarize` (kept in sync for a consistent label).
fn summarize_tool(name: &str, input: Option<&Value>) -> String {
    let field = |key: &str| input.and_then(|i| i.get(key)).and_then(|v| v.as_str());
    if let Some(rest) = name.strip_prefix("mcp__") {
        let mut parts = rest.split("__");
        let server = parts.next().unwrap_or("");
        let tool = parts.collect::<Vec<_>>().join("/");
        return if tool.is_empty() {
            format!("mcp:{server}")
        } else {
            format!("mcp:{server}/{tool}")
        };
    }
    match name {
        "Bash" => field("command")
            .map(|c| format!("Bash:{}", clip(c, 48)))
            .unwrap_or_else(|| "Bash".into()),
        "Edit" | "Write" | "Read" | "NotebookEdit" => field("file_path")
            .or_else(|| field("notebook_path"))
            .map(|p| format!("{name}:{}", basename(p)))
            .unwrap_or_else(|| name.into()),
        "Task" => field("subagent_type")
            .or_else(|| field("description"))
            .map(|l| format!("Task:{}", clip(l, 40)))
            .unwrap_or_else(|| "Task".into()),
        "" => "tool".into(),
        _ => name.into(),
    }
}

fn basename(p: &str) -> &str {
    p.rsplit(['/', '\\']).next().unwrap_or(p)
}

fn clip(s: &str, max: usize) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > max {
        let kept: String = one_line.chars().take(max - 1).collect();
        format!("{kept}…")
    } else {
        one_line
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-events-{tag}-{nanos}"));
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

    fn ev(pane: &str, sid: &str, name: &str, ts: i64) -> AgentEvent {
        AgentEvent {
            pane_id: pane.into(),
            session_id: sid.into(),
            hook_event_name: name.into(),
            ts,
            tool_name: None,
            summary: None,
            question: None,
            notification: None,
        }
    }

    fn send_line(socket: &Path, line: &str) {
        use std::io::Write;
        use std::os::unix::net::UnixStream;
        let mut s = UnixStream::connect(socket).unwrap();
        s.write_all(line.as_bytes()).unwrap();
        // Drop closes the stream -> server reads to EOF.
    }

    /// A well-formed line is parsed, emitted to the callback, and buffered in the
    /// pane ring.
    #[test]
    fn accepted_event_is_emitted_and_buffered() {
        let tmp = TempDir::new("accept");
        let socket = tmp.path().join("events.sock");
        let state = Arc::new(EventState::new(tmp.path().join("events")));
        let (tx, rx) = mpsc::channel::<AgentEvent>();
        let server = start_event_server(&socket, state.clone(), move |e| {
            let _ = tx.send(e);
        })
        .unwrap();

        send_line(
            &socket,
            r#"{"paneId":"p1","sessionId":"s1","hookEventName":"PreToolUse","ts":5,"toolName":"Bash","summary":"Bash:ls"}"#,
        );

        let got = rx.recv_timeout(Duration::from_secs(5)).expect("emitted");
        assert_eq!(got.pane_id, "p1");
        assert_eq!(got.summary.as_deref(), Some("Bash:ls"));
        // Buffered in the ring for the pane.
        let ring = state.ring_for("p1");
        assert_eq!(ring.len(), 1);
        assert_eq!(ring[0].hook_event_name, "PreToolUse");
        drop(server);
    }

    /// A malformed line fires no callback and the accept loop keeps serving.
    #[test]
    fn malformed_line_is_dropped() {
        let tmp = TempDir::new("malformed");
        let socket = tmp.path().join("events.sock");
        let state = Arc::new(EventState::new(tmp.path().join("events")));
        let (tx, rx) = mpsc::channel::<AgentEvent>();
        let server = start_event_server(&socket, state.clone(), move |e| {
            let _ = tx.send(e);
        })
        .unwrap();

        send_line(&socket, "{not json");
        send_line(&socket, r#"{"hookEventName":"Stop"}"#); // missing paneId
        // No callback for either malformed line.
        assert!(rx.recv_timeout(Duration::from_millis(400)).is_err());
        // A subsequent valid line still works (loop survived).
        send_line(
            &socket,
            r#"{"paneId":"p2","sessionId":"s2","hookEventName":"Stop","ts":1}"#,
        );
        let got = rx.recv_timeout(Duration::from_secs(5)).expect("still serving");
        assert_eq!(got.pane_id, "p2");
        drop(server);
    }

    /// A leftover socket file from a prior run does not stop a fresh bind.
    #[test]
    fn stale_socket_recreated_on_boot() {
        let tmp = TempDir::new("stale");
        let socket = tmp.path().join("events.sock");
        // Simulate a stale socket file left by a crash.
        std::fs::write(&socket, b"stale").unwrap();
        let state = Arc::new(EventState::new(tmp.path().join("events")));
        let server = start_event_server(&socket, state, |_| {}).expect("binds despite stale file");
        // The socket is now a live listener — a client can connect.
        let start = Instant::now();
        loop {
            if std::os::unix::net::UnixStream::connect(&socket).is_ok() {
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(2), "never became live");
        }
        drop(server);
    }

    /// Recording an event appends a line to that session's durable sink.
    #[test]
    fn event_appended_to_the_session_sink() {
        let tmp = TempDir::new("sink");
        let state = EventState::new(tmp.path().join("events"));
        state.record(&ev("p1", "sess-A", "Stop", 1));
        state.record(&ev("p1", "sess-A", "SessionStart", 2));
        let persisted = state.sink_for("sess-A");
        assert_eq!(persisted.len(), 2);
        assert_eq!(persisted[0].hook_event_name, "Stop");
        assert_eq!(persisted[1].hook_event_name, "SessionStart");
    }

    /// Two sessions sharing nothing but a pane prefix write to distinct files.
    #[test]
    fn sink_keyed_by_sessionid_matches_the_transcript() {
        let tmp = TempDir::new("keyed");
        let state = EventState::new(tmp.path().join("events"));
        state.record(&ev("p1", "sess-A", "Stop", 1));
        state.record(&ev("p2", "sess-B", "Stop", 1));
        assert_eq!(state.sink_for("sess-A").len(), 1);
        assert_eq!(state.sink_for("sess-B").len(), 1);
        assert!(tmp.path().join("events/sess-A.jsonl").is_file());
        assert!(tmp.path().join("events/sess-B.jsonl").is_file());
    }

    /// An aged-out session log is removed by `prune`.
    #[test]
    fn old_session_log_pruned() {
        let tmp = TempDir::new("oldlog");
        let dir = tmp.path().join("events");
        let state = EventState::new(dir.clone());
        state.record(&ev("p1", "old", "Stop", 1));
        let path = dir.join("old.jsonl");
        // Backdate the file well beyond the retention window.
        let old = SystemTime::now() - (RETENTION + Duration::from_secs(86_400));
        filetime_set(&path, old);
        state.prune();
        assert!(!path.exists(), "aged log must be pruned");
    }

    /// An oversized log is truncated from the head, preserving the newest lines.
    #[test]
    fn oversized_log_truncated_from_the_head() {
        let tmp = TempDir::new("biglog");
        let dir = tmp.path().join("events");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("big.jsonl");
        // Write more than the cap; last line is a recognizable marker.
        use std::io::Write;
        let mut f = std::fs::File::create(&path).unwrap();
        let filler = "x".repeat(1024);
        let lines = (MAX_LOG_BYTES / 1024) + 16;
        for _ in 0..lines {
            writeln!(f, "{filler}").unwrap();
        }
        writeln!(f, "NEWEST").unwrap();
        drop(f);
        assert!(std::fs::metadata(&path).unwrap().len() > MAX_LOG_BYTES);

        let state = EventState::new(dir);
        state.prune();

        let meta = std::fs::metadata(&path).unwrap();
        assert!(meta.len() <= MAX_LOG_BYTES, "must be within the cap");
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.lines().last() == Some("NEWEST"), "newest line preserved");
    }

    /// Reopening a session reads its prior timeline back from the durable sink.
    #[test]
    fn resume_shows_prior_timeline() {
        let tmp = TempDir::new("resume");
        let state = EventState::new(tmp.path().join("events"));
        state.record(&ev("p1", "sess-R", "PreToolUse", 1));
        state.record(&ev("p1", "sess-R", "PostToolUse", 2));
        // A FRESH state (simulating a restart) over the same dir reads the sink.
        let restarted = EventState::new(tmp.path().join("events"));
        let timeline = restarted.sink_for("sess-R");
        assert_eq!(timeline.len(), 2);
        assert_eq!(timeline[0].ts, 1);
        assert_eq!(timeline[1].ts, 2);
    }

    /// A session with no sink reconstructs a completed-tool timeline from its
    /// transcript's tool_use / tool_result blocks.
    #[test]
    fn backfill_for_pre_existing_sessions() {
        let tmp = TempDir::new("backfill");
        let transcript = tmp.path().join("sess-old.jsonl");
        let body = [
            serde_json::json!({
                "type":"assistant","timestamp":"2026-06-03T12:00:00.000Z",
                "message":{"content":[
                    {"type":"text","text":"working"},
                    {"type":"tool_use","name":"Bash","input":{"command":"npm test"}}
                ]}
            }),
            serde_json::json!({
                "type":"user","timestamp":"2026-06-03T12:00:01.000Z",
                "message":{"content":[{"type":"tool_result","content":"ok"}]}
            }),
        ]
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(&transcript, body).unwrap();

        let events = backfill_from_transcript(&transcript, "p1", "sess-old");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].hook_event_name, "PreToolUse");
        assert_eq!(events[0].tool_name.as_deref(), Some("Bash"));
        assert_eq!(events[0].summary.as_deref(), Some("Bash:npm test"));
        assert!(events[0].ts > 0, "timestamp parsed from the transcript");
        assert_eq!(events[1].hook_event_name, "PostToolUse");
    }

    /// Backdate a file's mtime via the stable `File::set_modified` (no FFI / extra
    /// crate), so the age-based prune can be exercised deterministically.
    fn filetime_set(path: &Path, when: SystemTime) {
        let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_modified(when).unwrap();
    }
}
