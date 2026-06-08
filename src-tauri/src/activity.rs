//! Live TRANSCRIPT activity for the `agent-overview` capability.
//!
//! The statusline-driven snapshot is unreliable as a data source: Claude only
//! re-renders the status bar sporadically (and never while blocked on an
//! `AskUserQuestion` prompt), and the whole pipeline depends on a node statusline
//! command running in the spawned env. So this module derives an agent's
//! high-level activity straight from its session TRANSCRIPT instead — the
//! `~/.claude/projects/<project>/<session>.jsonl` file Claude appends a line to
//! every turn — located purely from the pane's CWD (no session id, no snapshot
//! needed). The frontend POLLS [`activity_for_panes`] on a short clock, so the
//! overview reflects "what the agent just said" and "it's waiting on your answer"
//! within a second or two, independent of the statusline.
//!
//! A pane maps to its transcript by encoding the cwd the way Claude names its
//! project dirs (`/` -> `-`, via [`crate::subagents::project_dir_for_cwd`]) and
//! taking the NEWEST `*.jsonl` in that dir — the active session's transcript is
//! the one being appended to, so it is the most-recently-modified.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::subagents::{default_projects_base, project_dir_for_cwd};

/// How many trailing bytes of a transcript to read. The tail holds the newest
/// turns; reading only it keeps this cheap even for a multi-MB transcript.
const TAIL_BYTES: u64 = 256 * 1024;

/// Max chars for the last-message summary / a pending question (truncated).
const SUMMARY_MAX: usize = 160;
const QUESTION_MAX: usize = 200;

/// Max chars per recent message in the overview transcript preview (multi-line
/// preserved). Generous enough for the 8-line preview + full-message-when-waiting.
const MESSAGE_MAX: usize = 1400;
/// How many recent assistant text messages to surface (newest last).
const RECENT_MESSAGES: usize = 6;

// ---------------------------------------------------------------------------
// Output shape (the frontend contract).
// ---------------------------------------------------------------------------

/// One selectable option of a pending `AskUserQuestion` (label + its longer help).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    /// The option's short label (what the user picks).
    pub label: String,
    /// The option's longer description, or empty.
    #[serde(default)]
    pub description: String,
}

/// One pending question of an `AskUserQuestion` call: its header, prompt text,
/// whether multiple options may be chosen, and the selectable options.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingQuestion {
    /// A short header/label for the question, or empty.
    #[serde(default)]
    pub header: String,
    /// The question prompt text.
    pub question: String,
    /// Whether more than one option may be selected.
    #[serde(default)]
    pub multi_select: bool,
    /// The selectable options (empty for an open-ended free-text question).
    #[serde(default)]
    pub options: Vec<QuestionOption>,
}

/// The high-level activity for one agent pane, derived from its transcript.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// The newest assistant message text (collapsed + truncated) — "the last thing
    /// the agent said", or `null` when none / unavailable.
    #[serde(default)]
    pub summary: Option<String>,
    /// The joined text of the PENDING `AskUserQuestion` (the agent asked you and is
    /// still waiting), or `null` — a compact one-line form for the callout.
    #[serde(default)]
    pub question: Option<String>,
    /// The full structured pending question(s) — header, options, multi-select — so
    /// the overview can render the choices and answer on the user's behalf. `null`
    /// when nothing is pending.
    #[serde(default)]
    pub questions: Option<Vec<PendingQuestion>>,
    /// Context-window usage 0..100 derived from the newest assistant message's
    /// token usage (input + cache tokens / the model's window), or `null`.
    #[serde(default)]
    pub context_pct: Option<f64>,
    /// The recent assistant TEXT messages (newest LAST), each multi-line preserved
    /// and truncated — the overview renders these as the transcript preview (the
    /// last one prominent, older ones faded). `null` when none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub messages: Option<Vec<String>>,
    /// A cheap stable hash of the USER's messages — changes only when the user adds
    /// a message. The overview uses it to regenerate the session title (which
    /// is derived from the user's messages) ONLY when it actually changed, rather
    /// than on every poll. `null` when the user has sent nothing yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_hash: Option<String>,
}

/// One pane the frontend wants activity for: its frontend `pane_id` (the map key),
/// the APP-OWNED `session_id` (the exact transcript to read — claude was spawned
/// with `--session-id <id>`), and the `cwd` (a fast-path hint for locating the
/// project dir). Serialized camelCase for the JS side.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneRef {
    /// The frontend pane id — the activity map key (matches the roster row).
    pub pane_id: String,
    /// The app-owned Claude session id; its transcript is `<session_id>.jsonl`.
    /// Absent -> the pane is skipped (no exact transcript to read).
    #[serde(default)]
    pub session_id: Option<String>,
    /// The pane's absolute working directory (fast-path hint), or `null`.
    #[serde(default)]
    pub cwd: Option<String>,
}

// ---------------------------------------------------------------------------
// PURE transcript parse.
// ---------------------------------------------------------------------------

/// Collapse every whitespace run (incl. newlines) to a single space, trimmed.
fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Truncate an already-collapsed string to `max` CHARS with a trailing ellipsis.
fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        return s.to_string();
    }
    let head: String = chars[..max.saturating_sub(1)].iter().collect();
    format!("{}…", head.trim_end())
}

/// Read the LAST `max_bytes` of a file as (lossy) UTF-8, dropping a possibly-
/// truncated first line when the file exceeded the window. `None` on any IO error.
fn read_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    let start = size.saturating_sub(max_bytes);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        return Some(match text.find('\n') {
            Some(i) => text[i + 1..].to_string(),
            None => String::new(),
        });
    }
    Some(text)
}

/// Read the FIRST `max_bytes` of a file as (lossy) UTF-8, dropping a possibly-
/// truncated LAST line when the file exceeded the window. `None` on any IO error.
/// The HEAD holds a session's OPENING entries — where the user's first prompt
/// lives — which the tail loses in a long agent turn.
fn read_head(path: &Path, max_bytes: u64) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    let mut buf = vec![0u8; max_bytes.min(size) as usize];
    f.read_exact(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf).into_owned();
    if size > max_bytes {
        return Some(match text.rfind('\n') {
            Some(i) => text[..i].to_string(),
            None => String::new(),
        });
    }
    Some(text)
}

/// The pending-question text from an `AskUserQuestion` tool input, or `None`.
fn extract_question(input: &Value) -> Option<String> {
    let qs = input.get("questions")?.as_array()?;
    let mut parts = Vec::new();
    for q in qs {
        if let Some(text) = q.get("question").and_then(Value::as_str) {
            let c = collapse(text);
            if !c.is_empty() {
                parts.push(c);
            }
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(truncate(&parts.join(" • "), QUESTION_MAX))
}

/// The joined text of an assistant entry's text blocks (newline-separated),
/// trimmed; `None` when the entry carries no non-empty text block. Newlines are
/// PRESERVED (unlike the collapsed summary) so the overview can render Markdown.
fn assistant_text(entry: &Value) -> Option<String> {
    let mut parts = Vec::new();
    for block in assistant_content(entry) {
        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(t) = block.get("text").and_then(Value::as_str) {
                let t = t.trim();
                if !t.is_empty() {
                    parts.push(t.to_string());
                }
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

/// The user's prose text from a `user` entry, or `None`. The `content` is either a
/// plain string (the user's typed message) or an array of blocks — in the array
/// case only `text` blocks are kept, so a tool_result-only user entry yields
/// `None` (it isn't a message the user wrote).
fn user_text(entry: &Value) -> Option<String> {
    if entry.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let content = entry.get("message").and_then(|m| m.get("content"))?;
    if let Some(s) = content.as_str() {
        let t = s.trim();
        if t.is_empty() || is_meta_command(t) {
            return None;
        }
        return Some(t.to_string());
    }
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for b in arr {
            if b.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(t) = b.get("text").and_then(Value::as_str) {
                    let t = t.trim();
                    if !t.is_empty() && !is_meta_command(t) {
                        parts.push(t.to_string());
                    }
                }
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

/// Whether `t` is a session-control command rather than the user saying something:
/// the bare words `exit`/`quit`, or a `/exit`, `/quit`, `/clear`, `/compact` slash
/// command (which `claude` records as `<command-name>/NAME</command-name>…`). These
/// don't count as user messages — a session whose only user entries are these is
/// EMPTY (deleted on archive, no session title). `t` is already trimmed.
fn is_meta_command(t: &str) -> bool {
    if t.eq_ignore_ascii_case("exit") || t.eq_ignore_ascii_case("quit") {
        return true;
    }
    let Some(rest) = t.strip_prefix("<command-name>/") else {
        return false;
    };
    let Some(name) = rest.split_once("</command-name>").map(|(name, _)| name) else {
        return false;
    };
    matches!(name, "exit" | "quit" | "clear" | "compact")
}

/// A stable hex hash of a list of strings (order + content sensitive).
fn hash_strings(items: &[String]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    items.len().hash(&mut h);
    for s in items {
        s.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

/// Every USER prose message in a transcript, in order (oldest first). Reads the
/// WHOLE file (not just the tail) so a session title reflects all of the user's
/// messages. Tolerant of malformed lines; empty when none / unreadable.
pub fn user_messages(path: &Path) -> Vec<String> {
    let Ok(body) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(t) {
            if let Some(text) = user_text(&v) {
                out.push(text);
            }
        }
    }
    out
}

/// The content blocks of an `assistant` entry, or empty.
fn assistant_content(entry: &Value) -> &[Value] {
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return &[];
    }
    entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// Whether `entry` carries a `tool_result` answering `qid` (any tool_result when
/// `qid` is None — the question's tool_use had no id to match on).
fn answers_question(entry: &Value, qid: Option<&str>) -> bool {
    let content = entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array);
    let Some(content) = content else { return false };
    content.iter().any(|b| {
        if b.get("type").and_then(Value::as_str) != Some("tool_result") {
            return false;
        }
        match qid {
            None => true,
            Some(id) => b.get("tool_use_id").and_then(Value::as_str) == Some(id),
        }
    })
}

/// The context window size (tokens) for a model id — 1M for the `[1m]` variants,
/// else the standard 200k.
fn window_for_model(model: Option<&str>) -> f64 {
    match model {
        Some(m) if m.contains("[1m]") || m.contains("1m") => 1_000_000.0,
        _ => 200_000.0,
    }
}

/// Context-window usage 0..100 from an assistant message's `usage` (the prompt
/// tokens it carried — input + both cache figures — over the model's window).
fn context_pct_from(entry: &Value) -> Option<f64> {
    let msg = entry.get("message")?;
    let usage = msg.get("usage")?;
    let n = |k: &str| usage.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let prompt = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
    if prompt <= 0.0 {
        return None;
    }
    let window = window_for_model(msg.get("model").and_then(Value::as_str));
    Some((prompt / window * 100.0).clamp(0.0, 100.0))
}

/// Parse a session transcript file into its [`Activity`]:
///  - `summary`: the last assistant TEXT block anywhere in the tail.
///  - `question`: the last `AskUserQuestion` whose `tool_use_id` has no later
///    matching `tool_result` (i.e. still pending) — robust to interleaved entries.
///  - `context_pct`: from the newest assistant message that carries token `usage`.
///
/// Tail-reads the file; tolerant of malformed lines; never panics.
pub fn summarize_transcript(path: &Path) -> Activity {
    let mut out = Activity::default();
    let Some(body) = read_tail(path, TAIL_BYTES) else {
        return out;
    };

    let mut entries: Vec<Value> = Vec::new();
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(t) {
            entries.push(v);
        }
    }
    if entries.is_empty() {
        return out;
    }

    // SUMMARY: the last assistant text block anywhere in the tail.
    'summary: for entry in entries.iter().rev() {
        for block in assistant_content(entry).iter().rev() {
            if block.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    let s = truncate(&collapse(text), SUMMARY_MAX);
                    if !s.is_empty() {
                        out.summary = Some(s);
                        break 'summary;
                    }
                }
            }
        }
    }

    // MESSAGES: the last RECENT_MESSAGES assistant TEXT messages (newest LAST),
    // multi-line preserved + truncated, for the overview's transcript preview.
    let mut msgs: Vec<String> = Vec::new();
    for entry in entries.iter().rev() {
        if let Some(text) = assistant_text(entry) {
            msgs.push(truncate(&text, MESSAGE_MAX));
            if msgs.len() >= RECENT_MESSAGES {
                break;
            }
        }
    }
    if !msgs.is_empty() {
        msgs.reverse(); // newest LAST (the prominent one)
        out.messages = Some(msgs);
    }

    // USER-FOCUS hash: a cheap signal that the user's messages changed (so the
    // overview regenerates the session title only on a real change) AND that the
    // session has any real user message at all (one with none is EMPTY: its
    // archive action is a Delete, not a restorable Archive).
    //
    // The tail holds the NEWEST user messages, so the hash changes when the user
    // adds one. But in a long agentic run the last TAIL_BYTES can be ALL
    // assistant/tool output, with the user's prompts sitting earlier in the file;
    // a tail-only scan then finds NO user message and would wrongly mark a busy,
    // content-rich session empty ("Delete"). So when the tail carries none, fall
    // back to the HEAD — a real session always opens with the user's first prompt.
    let mut user_msgs: Vec<String> = entries.iter().filter_map(user_text).collect();
    if user_msgs.is_empty() {
        if let Some(head) = read_head(path, TAIL_BYTES) {
            user_msgs = head
                .lines()
                .filter_map(|l| serde_json::from_str::<Value>(l.trim()).ok())
                .filter_map(|v| user_text(&v))
                .collect();
        }
    }
    if !user_msgs.is_empty() {
        out.user_hash = Some(hash_strings(&user_msgs));
    }

    // QUESTION: the LAST AskUserQuestion tool_use, pending iff no later tool_result
    // references its id. Tracked across ALL entries (not just the newest turn) so
    // an attachment/meta entry after the question can't hide it.
    let mut last_q: Option<(usize, Option<String>, Value)> = None;
    for (i, entry) in entries.iter().enumerate() {
        for block in assistant_content(entry) {
            if block.get("type").and_then(Value::as_str) == Some("tool_use")
                && block.get("name").and_then(Value::as_str) == Some("AskUserQuestion")
            {
                let id = block.get("id").and_then(Value::as_str).map(str::to_string);
                if let Some(input) = block.get("input") {
                    last_q = Some((i, id, input.clone()));
                }
            }
        }
    }
    if let Some((qi, qid, input)) = last_q {
        let answered = entries[qi + 1..]
            .iter()
            .any(|e| answers_question(e, qid.as_deref()));
        if !answered {
            out.question = extract_question(&input);
        }
    }

    // CONTEXT: the newest assistant message carrying token usage.
    for entry in entries.iter().rev() {
        if entry.get("type").and_then(Value::as_str) == Some("assistant") {
            if let Some(pct) = context_pct_from(entry) {
                out.context_pct = Some(pct);
                break;
            }
        }
    }

    out
}

// ---------------------------------------------------------------------------
// Per-pane transcript lookup (by EXACT session id).
// ---------------------------------------------------------------------------

/// Reject a path component that could escape its parent (separators or `..`).
fn safe_component(id: &str) -> Option<&str> {
    let t = id.trim();
    if t.is_empty() || t.contains('/') || t.contains('\\') || t.contains("..") {
        None
    } else {
        Some(t)
    }
}

/// Locate a pane's transcript by its EXACT session id: `<session_id>.jsonl`. Tries
/// the cwd-encoded project dir first (fast path), then — since a session id is a
/// unique uuid — scans every project dir for the file (robust to a null/mismatched
/// cwd). `None` when the id is unsafe or no such transcript exists yet.
pub fn find_transcript(projects_base: &Path, pane: &PaneRef) -> Option<PathBuf> {
    let session = pane.session_id.as_deref().and_then(safe_component)?;
    let file = format!("{session}.jsonl");
    // Fast path: the cwd-encoded project dir.
    if let Some(cwd) = pane.cwd.as_deref() {
        let p = projects_base.join(project_dir_for_cwd(cwd)).join(&file);
        if p.is_file() {
            return Some(p);
        }
    }
    // Fallback: scan every project dir for the uniquely-named transcript.
    let entries = std::fs::read_dir(projects_base).ok()?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let p = entry.path().join(&file);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// The PENDING-question sidecar next to a transcript: `<dir>/<session_id>.question.json`.
/// The app's `question-hook.js` writes it on `PreToolUse[AskUserQuestion]` (as
/// `{"questions":[{header, question, multiSelect, options:[{label, description}]}]}`)
/// and deletes it once answered (`PostToolUse`/`Stop`). This is the ONLY reliable
/// source for a *pending* question: the assistant turn carrying the `AskUserQuestion`
/// is not written to the transcript until it's answered, so by the time it's on disk
/// it's no longer pending. Returns the structured question(s) when valid + non-empty.
fn read_pending_questions(transcript: &Path, session_id: &str) -> Option<Vec<PendingQuestion>> {
    let sidecar = transcript
        .parent()?
        .join(format!("{session_id}.question.json"));
    let body = std::fs::read_to_string(&sidecar).ok()?;
    let v: Value = serde_json::from_str(&body).ok()?;
    let arr = v.get("questions")?.as_array()?;
    let questions: Vec<PendingQuestion> = arr
        .iter()
        .filter_map(|q| serde_json::from_value(q.clone()).ok())
        .filter(|q: &PendingQuestion| !q.question.trim().is_empty())
        .collect();
    if questions.is_empty() {
        None
    } else {
        Some(questions)
    }
}

/// The compact one-line form of the pending question(s): each question's text,
/// collapsed and joined, truncated for the callout.
fn question_summary(questions: &[PendingQuestion]) -> Option<String> {
    let joined = questions
        .iter()
        .map(|q| collapse(&q.question))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" • ");
    if joined.is_empty() {
        None
    } else {
        Some(truncate(&joined, QUESTION_MAX))
    }
}

/// Build the `pane_id -> Activity` map for a set of panes rooted at
/// `projects_base`. Each pane's transcript is its EXACT `<session_id>.jsonl` — so
/// two agents in the same folder never cross-contaminate. A pane with no session
/// id, or whose transcript doesn't exist yet, is simply absent. Never panics.
///
/// A PENDING question is taken from the hook-written `<session_id>.question.json`
/// sidecar (it can't be read from the transcript — see [`read_pending_question`]);
/// it overrides the transcript's question, which is `None` while pending.
pub fn activity_for_panes(projects_base: &Path, panes: &[PaneRef]) -> HashMap<String, Activity> {
    let mut map = HashMap::new();
    for pane in panes {
        let Some(transcript) = find_transcript(projects_base, pane) else {
            continue;
        };
        let mut activity = summarize_transcript(&transcript);
        if let Some(sid) = pane.session_id.as_deref().and_then(safe_component) {
            if let Some(questions) = read_pending_questions(&transcript, sid) {
                activity.question = question_summary(&questions);
                activity.questions = Some(questions);
            }
        }
        map.insert(pane.pane_id.clone(), activity);
    }
    map
}

/// The default Claude projects base (`~/.claude/projects`), reused from
/// [`crate::subagents`].
pub fn projects_base() -> Option<PathBuf> {
    default_projects_base()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-activity-{tag}-{nanos}"));
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

    fn write_transcript(base: &Path, project: &str, sid: &str, lines: &[Value]) -> PathBuf {
        let dir = base.join(project);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{sid}.jsonl"));
        let body: String = lines
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        std::fs::write(&path, body).unwrap();
        path
    }

    fn assistant(content: Value) -> Value {
        serde_json::json!({"type":"assistant","message":{"role":"assistant","content":content}})
    }

    /// Spec scenario: "Last assistant message becomes the summary".
    #[test]
    fn last_assistant_message_becomes_the_summary() {
        let tmp = TempDir::new("summary");
        let path = write_transcript(
            tmp.path(),
            "-work-a",
            "sess-1",
            &[
                serde_json::json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":"go"}]}}),
                assistant(serde_json::json!([
                    {"type":"text","text":"Looking at the parser now\nto find the bug."},
                    {"type":"tool_use","name":"Read","input":{"file_path":"/x"}}
                ])),
            ],
        );
        let a = summarize_transcript(&path);
        assert_eq!(a.summary.as_deref(), Some("Looking at the parser now to find the bug."));
        assert!(a.question.is_none());
    }

    /// Spec scenario: "Pending question surfaces from the transcript".
    #[test]
    fn pending_question_surfaces_from_the_transcript() {
        let tmp = TempDir::new("question");
        let pending = write_transcript(
            tmp.path(),
            "-work-a",
            "sess-pending",
            &[assistant(serde_json::json!([
                {"type":"text","text":"I need a decision."},
                {"type":"tool_use","name":"AskUserQuestion",
                 "input":{"questions":[{"question":"Which database should we use?"}]}}
            ]))],
        );
        let a = summarize_transcript(&pending);
        assert_eq!(a.question.as_deref(), Some("Which database should we use?"));

        let answered = write_transcript(
            tmp.path(),
            "-work-a",
            "sess-answered",
            &[
                assistant(serde_json::json!([
                    {"type":"tool_use","name":"AskUserQuestion",
                     "input":{"questions":[{"question":"Which database should we use?"}]}}
                ])),
                serde_json::json!({"type":"user","message":{"role":"user",
                    "content":[{"type":"tool_result","content":"Postgres"}]}}),
            ],
        );
        assert!(summarize_transcript(&answered).question.is_none());
    }

    /// Context % is derived from the newest assistant message's token usage over the
    /// model window, and a pending question is matched by `tool_use_id` (a
    /// tool_result for a DIFFERENT id does not answer it).
    #[test]
    fn context_pct_and_tool_id_matching() {
        let tmp = TempDir::new("ctx");
        let ctx = write_transcript(
            tmp.path(),
            "-w",
            "s-ctx",
            &[serde_json::json!({
                "type":"assistant",
                "message":{
                    "role":"assistant","model":"claude-opus-4-8",
                    "content":[{"type":"text","text":"hi"}],
                    "usage":{"input_tokens":10000,"cache_read_input_tokens":40000,
                             "cache_creation_input_tokens":0,"output_tokens":500}
                }
            })],
        );
        let a = summarize_transcript(&ctx);
        // (10000 + 40000) / 200000 = 25%.
        assert_eq!(a.context_pct, Some(25.0));
        assert_eq!(a.summary.as_deref(), Some("hi"));

        // A question answered by a DIFFERENT tool id stays pending.
        let q = write_transcript(
            tmp.path(),
            "-w",
            "s-q",
            &[
                serde_json::json!({"type":"assistant","message":{"role":"assistant","content":[
                    {"type":"tool_use","id":"q1","name":"AskUserQuestion",
                     "input":{"questions":[{"question":"Pick?"}]}}]}}),
                serde_json::json!({"type":"user","message":{"role":"user","content":[
                    {"type":"tool_result","tool_use_id":"OTHER","content":"x"}]}}),
            ],
        );
        assert_eq!(summarize_transcript(&q).question.as_deref(), Some("Pick?"));
    }

    /// `activity_for_panes` resolves each pane's EXACT transcript by session id and
    /// keys the map by pane id — so two agents in the SAME folder never cross-
    /// contaminate (the bug cwd-only matching caused). A pane with no session id is
    /// omitted; a session with no cwd still resolves via the project-dir scan.
    #[test]
    fn activity_for_panes_maps_by_pane_id() {
        let tmp = TempDir::new("panes");
        let base = tmp.path();
        let cwd = "/work/a";
        let project = project_dir_for_cwd(cwd);
        // Two distinct sessions IN THE SAME folder.
        write_transcript(
            base,
            &project,
            "sess-A",
            &[assistant(serde_json::json!([{"type":"text","text":"from A"}]))],
        );
        write_transcript(
            base,
            &project,
            "sess-B",
            &[assistant(serde_json::json!([{"type":"text","text":"from B"}]))],
        );

        let panes = vec![
            // Same cwd, different sessions -> each reads its OWN transcript.
            PaneRef { pane_id: "pane-A".into(), session_id: Some("sess-A".into()), cwd: Some(cwd.into()) },
            PaneRef { pane_id: "pane-B".into(), session_id: Some("sess-B".into()), cwd: Some(cwd.into()) },
            // No cwd -> resolved via the project-dir scan (session ids are unique).
            PaneRef { pane_id: "pane-B2".into(), session_id: Some("sess-B".into()), cwd: None },
            // No session id -> omitted.
            PaneRef { pane_id: "pane-none".into(), session_id: None, cwd: Some(cwd.into()) },
        ];
        let map = activity_for_panes(base, &panes);
        assert_eq!(map.get("pane-A").and_then(|a| a.summary.as_deref()), Some("from A"));
        assert_eq!(map.get("pane-B").and_then(|a| a.summary.as_deref()), Some("from B"));
        assert_eq!(map.get("pane-B2").and_then(|a| a.summary.as_deref()), Some("from B"));
        assert!(!map.contains_key("pane-none"), "no session id -> omitted");
    }

    /// A PENDING question lives in the hook-written `<session_id>.question.json`
    /// sidecar (the transcript never carries it while pending). `activity_for_panes`
    /// reads that sidecar and uses it as the row's question; removing the sidecar
    /// (the hook's clear-on-answer) drops the question again.
    #[test]
    fn pending_question_comes_from_the_sidecar() {
        let tmp = TempDir::new("sidecar");
        let base = tmp.path();
        let cwd = "/work/q";
        let project = project_dir_for_cwd(cwd);
        // A transcript with assistant text but NO AskUserQuestion (the pending turn
        // isn't on disk) — exactly the live "agent is asking" shape.
        let path = write_transcript(
            base,
            &project,
            "sess-Q",
            &[assistant(serde_json::json!([{"type":"text","text":"thinking"}]))],
        );
        let sidecar = path.with_file_name("sess-Q.question.json");
        std::fs::write(
            &sidecar,
            r#"{"questions":[{"header":"DB","question":"Postgres or MySQL?","multiSelect":false,"options":[{"label":"Postgres","description":"relational"},{"label":"MySQL","description":""}]}]}"#,
        )
        .unwrap();

        let panes = vec![PaneRef {
            pane_id: "pane-Q".into(),
            session_id: Some("sess-Q".into()),
            cwd: Some(cwd.into()),
        }];
        let map = activity_for_panes(base, &panes);
        let a = map.get("pane-Q").unwrap();
        assert_eq!(a.summary.as_deref(), Some("thinking"));
        // Compact one-line form for the callout.
        assert_eq!(a.question.as_deref(), Some("Postgres or MySQL?"));
        // Structured options surfaced for the answer UI.
        let qs = a.questions.as_ref().unwrap();
        assert_eq!(qs.len(), 1);
        assert_eq!(qs[0].header, "DB");
        assert_eq!(qs[0].options.len(), 2);
        assert_eq!(qs[0].options[0].label, "Postgres");
        assert_eq!(qs[0].options[0].description, "relational");
        assert!(!qs[0].multi_select);

        // Hook clears it on answer -> no pending question.
        std::fs::remove_file(&sidecar).unwrap();
        let map2 = activity_for_panes(base, &panes);
        assert!(map2.get("pane-Q").unwrap().question.is_none());
        assert!(map2.get("pane-Q").unwrap().questions.is_none());
    }

    /// The recent assistant TEXT messages surface newest-LAST with newlines
    /// preserved (the overview renders them as the Markdown transcript preview).
    #[test]
    fn recent_messages_surface_newest_last() {
        let tmp = TempDir::new("messages");
        let path = write_transcript(
            tmp.path(),
            "proj",
            "sess-M",
            &[
                assistant(serde_json::json!([{"type":"text","text":"First message"}])),
                // A tool-only entry between messages is skipped (no text block).
                assistant(serde_json::json!([{"type":"tool_use","name":"Bash","input":{}}])),
                assistant(serde_json::json!([{"type":"text","text":"Second\nwith a line"}])),
            ],
        );
        let act = summarize_transcript(&path);
        let msgs = act.messages.expect("messages present");
        assert_eq!(msgs.len(), 2, "two text messages, tool-only entry skipped");
        assert_eq!(msgs[0], "First message");
        // Newest LAST, newlines PRESERVED (unlike the collapsed one-line summary).
        assert_eq!(msgs[1], "Second\nwith a line");
        // The summary is still the collapsed last message (newlines flattened).
        assert_eq!(act.summary.as_deref(), Some("Second with a line"));
        // A user-focus hash is present once the user has messaged.
        assert!(act.user_hash.is_none(), "no user messages in this transcript yet");
    }

    /// `user_messages` returns only the user's PROSE (string or text-block content),
    /// skipping assistant turns and tool_result-only user entries.
    #[test]
    fn user_messages_extracts_user_prose_only() {
        let tmp = TempDir::new("usermsgs");
        let path = write_transcript(
            tmp.path(),
            "proj",
            "sess-U",
            &[
                serde_json::json!({"type":"user","message":{"role":"user","content":"Fix the parser bug"}}),
                assistant(serde_json::json!([{"type":"text","text":"on it"}])),
                // A tool_result-only user entry is NOT a user message.
                serde_json::json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}),
                serde_json::json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":"Now add tests"}]}}),
            ],
        );
        let msgs = user_messages(&path);
        assert_eq!(msgs, vec!["Fix the parser bug".to_string(), "Now add tests".to_string()]);

        // And the activity user_hash is populated + stable for the same content.
        let act = summarize_transcript(&path);
        assert!(act.user_hash.is_some());
        assert_eq!(act.user_hash, summarize_transcript(&path).user_hash);
    }

    /// Exit/quit/clear/compact entries are NOT the user "saying something" — a
    /// session whose only user entries are these is EMPTY (deleted on archive, no
    /// title). They are dropped from `user_messages` so `user_hash` stays None.
    #[test]
    fn exit_and_meta_commands_do_not_count_as_user_messages() {
        let tmp = TempDir::new("exitcmds");
        // The exact shape `claude` writes when the user runs /exit (and friends):
        // a plain-string user entry with the <command-name> markup + leading indent.
        let cmd = |name: &str| {
            serde_json::json!({"type":"user","message":{"role":"user","content":
                format!("<command-name>/{name}</command-name>\n            <command-message>{name}</command-message>\n            <command-args></command-args>")}})
        };
        let bare = |t: &str| {
            serde_json::json!({"type":"user","message":{"role":"user","content": t}})
        };

        // A session whose ONLY user entries are exit/quit/clear/compact (slash and
        // bare forms) has no real user message -> empty.
        let empty = write_transcript(
            tmp.path(),
            "proj",
            "sess-empty",
            &[
                bare("exit"),
                bare("quit"),
                cmd("exit"),
                cmd("quit"),
                cmd("clear"),
                cmd("compact"),
            ],
        );
        assert!(user_messages(&empty).is_empty(), "no real user prose");
        assert!(
            summarize_transcript(&empty).user_hash.is_none(),
            "empty session -> no user_hash -> deleted on archive"
        );

        // A real prose message followed by /exit keeps ONLY the prose.
        let real = write_transcript(
            tmp.path(),
            "proj",
            "sess-real",
            &[bare("Fix the parser bug"), cmd("exit")],
        );
        assert_eq!(user_messages(&real), vec!["Fix the parser bug".to_string()]);
        assert!(summarize_transcript(&real).user_hash.is_some());
    }

    /// A long, content-rich session whose newest `TAIL_BYTES` are ALL assistant/
    /// tool output (a single long agent turn) STILL reports a `user_hash`: the
    /// user's first prompt lives at the HEAD of the transcript, so the session
    /// reads as Archive — not the empty-session "Delete". Regression: a tail-only
    /// scan found no user message here and wrongly marked busy sessions empty.
    #[test]
    fn long_agent_turn_keeps_user_hash_from_head() {
        let tmp = TempDir::new("longturn");
        // The user's real prompt at the HEAD, then > TAIL_BYTES of assistant output
        // so the last window holds no user entry at all.
        let big = "x".repeat(70_000);
        let mut lines = vec![serde_json::json!(
            {"type":"user","message":{"role":"user","content":"Refactor the auth module"}}
        )];
        for _ in 0..6 {
            lines.push(assistant(serde_json::json!([{"type":"text","text": big}])));
        }
        let path = write_transcript(tmp.path(), "proj", "sess-long", &lines);
        assert!(
            std::fs::metadata(&path).unwrap().len() > TAIL_BYTES,
            "fixture must exceed the tail window to exercise the bug"
        );
        let act = summarize_transcript(&path);
        assert!(
            act.user_hash.is_some(),
            "a content-rich session must read as Archive (user_hash present), not empty Delete"
        );
    }
}
