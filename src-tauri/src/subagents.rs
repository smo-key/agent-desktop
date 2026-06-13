//! Subagent reader for the `agent-overview` capability (Milestone 10, task 10.2,
//! Stage 2).
//!
//! An app agent (a `claude` session) can spawn SUBAGENTS — Task-tool agents and
//! workflow agents. Claude Code records these under the session's project
//! directory:
//!
//! ```text
//! ~/.claude/projects/<project>/<session>/
//!   workflows/<wf_id>.json                                  (run record)
//!   subagents/workflows/<wf_id>/agent-<agentId>.meta.json   (per-subagent meta)
//!   subagents/workflows/<wf_id>/agent-<agentId>.jsonl       (transcript)
//! ```
//!
//! The RICH per-subagent data lives in the workflow run record's
//! `workflowProgress` array, which interleaves `workflow_phase` and
//! `workflow_agent` entries. Each `workflow_agent` carries `label`, `agentId`,
//! `model`, `state`, `tokens`, `toolCalls`, `durationMs`, and assorted previews
//! (observed verbatim on disk — see the module tests for the exact shape). The
//! `agent-<agentId>.meta.json` sidecars are minimal (`{"agentType":"…"}`) and only
//! confirm a subagent's existence; we tolerate their absence entirely.
//!
//! This module is split the same way as [`crate::usage`] / [`crate::task`]:
//!
//!   1. A PURE parser ([`parse_session_subagents`]) — given a session's project
//!      directory, enumerate every subagent from its `workflows/*.json` records
//!      into `Vec<Subagent>`. Absent/partial/malformed records are SKIPPED or
//!      surfaced with only their available fields; it never panics.
//!
//!   2. IO/lookup ([`subagents_for_sessions`], [`project_dir_for_cwd`]) mapping
//!      Claude's project-dir encoding (the cwd with every `/` replaced by `-`) so
//!      the frontend can ask for a set of sessions by id + cwd.
//!
//!   3. A `notify` WATCHER ([`start_subagents_watcher`]) over the projects base
//!      that re-emits the per-session map whenever any of those dirs change,
//!      pushed to the frontend as the Tauri event `overview://subagents`.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How many bytes of the parent transcript's TAIL to scan for `Task` tool_use /
/// tool_result ids when deriving standalone-subagent status. A live subagent's
/// `tool_use` is necessarily recent (near the tail); anything not found in the
/// tail has scrolled out (old) and is treated as finished. Bounds the per-recompute
/// read cost the way [`crate::activity`] bounds its own transcript tail.
const PARENT_TAIL_BYTES: u64 = 1 << 20; // 1 MiB

/// The Tauri event name the subagents watcher emits the per-session map on. The
/// frontend listens on exactly this name.
pub const SUBAGENTS_EVENT: &str = "overview://subagents";

/// Coalescing window: an identical recomputed map re-observed within this span
/// (across a burst of fs events for one logical write) is not re-emitted. macOS
/// FSEvents fires several events per write; this keeps us from pushing the same
/// map to the frontend many times in a row. Mirrors [`crate::usage`].
const COALESCE_WINDOW: Duration = Duration::from_millis(250);

// ---------------------------------------------------------------------------
// Output shape (the frontend contract).
// ---------------------------------------------------------------------------

/// Usage recorded for a single subagent. Every field is optional: a record may
/// carry only token counts, only a cost, etc. (the on-disk workflow record
/// carries `tokens`; `cost`/`context_pct` are absent today but reserved so a
/// richer future record — or a transcript-derived cost — fits without a shape
/// change). Serialized camelCase for the JS side; aligns with Stage 1's
/// `SubagentUsage = { cost: number | null }` (a superset of it).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SubagentUsage {
    /// Cost in USD for this subagent, or `null` when not recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    /// Total tokens this subagent consumed, or `null` when not recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    /// Context-window usage 0..100 for this subagent, or `null`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_pct: Option<f64>,
}

impl SubagentUsage {
    /// Whether this usage carries no value at all (all fields absent). Such a
    /// record is collapsed to `usage: None` so the aggregate can cleanly skip it.
    fn is_empty(&self) -> bool {
        self.cost.is_none() && self.tokens.is_none() && self.context_pct.is_none()
    }
}

/// One subagent surfaced under its parent agent. `id` and `parent_session` are
/// always present (an entry with neither a usable id nor any label is dropped);
/// `label`/`status`/`model`/`usage` are best-effort and may be `null` when the
/// source record omits them. Serialized camelCase for the JS side.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    /// The subagent agent id (e.g. `a45490d0ade2c7a7c`), matching the
    /// `agent-<id>.meta.json`/`.jsonl` sidecars. Stable within a session.
    pub id: String,
    /// Human label (e.g. `spec:terminal-core`), or `null` when not recorded.
    #[serde(default)]
    pub label: Option<String>,
    /// Lifecycle state verbatim from the record (`done`, and — not hardcoded —
    /// whatever else Claude writes such as `running`/`queued`/`error`), or `null`.
    #[serde(default)]
    pub status: Option<String>,
    /// The model the subagent ran on (e.g. `claude-opus-4-8[1m]`), or `null`.
    #[serde(default)]
    pub model: Option<String>,
    /// Recorded usage (tokens/cost/context), or `null` when nothing is recorded.
    #[serde(default)]
    pub usage: Option<SubagentUsage>,
    /// The parent session id this subagent was spawned under.
    pub parent_session: String,
    /// The workflow run id (`wf_…`) this subagent belongs to, or `null` when it
    /// came from a meta sidecar with no matching run record. Lets the UI group
    /// subagents by workflow under the parent.
    #[serde(default)]
    pub workflow_id: Option<String>,
    /// The workflow phase title this subagent ran under (e.g. `Capabilities`), or
    /// `null`. Lets the UI sub-group a workflow's subagents by phase.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_title: Option<String>,
    /// The workflow phase index (ordinal) this subagent ran under, or `null`. Used
    /// to order phase groups in the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_index: Option<i64>,
    /// When the subagent started, as a Unix epoch in MILLISECONDS, or `null`. Lets
    /// the UI compute "duration alive" for a still-running subagent (`now - startedAt`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    /// The subagent's total run duration in MILLISECONDS once finished, or `null`
    /// while still running. The UI prefers this over `now - startedAt` when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
}

// ---------------------------------------------------------------------------
// Raw (schema-tolerant) deserialization of a workflow run record.
// ---------------------------------------------------------------------------

/// A workflow run record (`workflows/<wf_id>.json`). Schema-TOLERANT: only the
/// `workflowProgress` array is read; every other documented field (`agentCount`,
/// `defaultModel`, `status`, `summary`, …) is ignored, and unknown fields never
/// cause a parse failure. A file that isn't a JSON object, or that lacks
/// `workflowProgress`, yields an empty list rather than an error.
#[derive(Debug, Default, Deserialize)]
struct WorkflowRecord {
    /// The interleaved phase/agent progress entries. Absent -> empty.
    #[serde(default, rename = "workflowProgress")]
    workflow_progress: Vec<ProgressEntry>,
}

/// One `workflowProgress` entry. We care only about `type == "workflow_agent"`
/// rows; `workflow_phase` (and any other) rows deserialize fine and are filtered
/// out by [`ProgressEntry::into_subagent`]. Every per-agent field is optional so a
/// partial row still yields a partial [`Subagent`] instead of being dropped.
#[derive(Debug, Default, Deserialize)]
struct ProgressEntry {
    /// Entry discriminator: `workflow_agent` | `workflow_phase` | (other).
    #[serde(default, rename = "type")]
    kind: Option<String>,
    /// The subagent agent id (the join key to the meta/jsonl sidecars).
    #[serde(default, rename = "agentId")]
    agent_id: Option<String>,
    /// Human label, e.g. `spec:terminal-core`.
    #[serde(default)]
    label: Option<String>,
    /// Lifecycle state, e.g. `done`/`running`/`error` (read verbatim).
    #[serde(default)]
    state: Option<String>,
    /// Model id, e.g. `claude-opus-4-8[1m]`.
    #[serde(default)]
    model: Option<String>,
    /// Total tokens consumed, when recorded.
    #[serde(default)]
    tokens: Option<u64>,
    /// Cost in USD, when recorded (reserved; absent in today's records).
    #[serde(default)]
    cost: Option<f64>,
    /// Context-window usage 0..100, when recorded (reserved).
    #[serde(default, rename = "contextPct")]
    context_pct: Option<f64>,
    /// Workflow phase title this agent ran under, e.g. `Capabilities`.
    #[serde(default, rename = "phaseTitle")]
    phase_title: Option<String>,
    /// Workflow phase ordinal this agent ran under.
    #[serde(default, rename = "phaseIndex")]
    phase_index: Option<i64>,
    /// Start time as a Unix epoch in milliseconds.
    #[serde(default, rename = "startedAt")]
    started_at: Option<i64>,
    /// Total run duration in milliseconds, once finished.
    #[serde(default, rename = "durationMs")]
    duration_ms: Option<i64>,
}

impl ProgressEntry {
    /// Convert a `workflow_agent` entry into a [`Subagent`], attributing it to
    /// `parent_session` / `workflow_id`. Returns `None` for non-agent rows and for
    /// agent rows that carry NEITHER a usable id NOR any label (nothing to show).
    /// When an id is missing but a label exists, a synthetic id is derived from the
    /// label so the row still surfaces (partial, never dropped).
    fn into_subagent(self, parent_session: &str, workflow_id: &str) -> Option<Subagent> {
        if self.kind.as_deref() != Some("workflow_agent") {
            return None;
        }
        let id =
            non_empty(self.agent_id.as_deref()).or_else(|| non_empty(self.label.as_deref()))?;
        let usage = SubagentUsage {
            cost: self.cost,
            tokens: self.tokens,
            context_pct: self.context_pct,
        };
        Some(Subagent {
            id,
            label: non_empty(self.label.as_deref()),
            status: non_empty(self.state.as_deref()),
            model: non_empty(self.model.as_deref()),
            usage: if usage.is_empty() { None } else { Some(usage) },
            parent_session: parent_session.to_string(),
            workflow_id: non_empty(Some(workflow_id)),
            phase_title: non_empty(self.phase_title.as_deref()),
            phase_index: self.phase_index,
            started_at: self.started_at,
            duration_ms: self.duration_ms,
        })
    }
}

/// Trim a candidate; return it owned only when non-empty after trimming.
fn non_empty(v: Option<&str>) -> Option<String> {
    let t = v?.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

// ---------------------------------------------------------------------------
// (1) PURE parse of a session's subagents.
// ---------------------------------------------------------------------------

/// Parse every subagent for a session given its project session directory
/// (`~/.claude/projects/<project>/<session>/`), attributing them to
/// `session_id`.
///
/// Enumerates `workflows/*.json`, parses each as a (schema-tolerant)
/// [`WorkflowRecord`], and flattens every `workflow_agent` row into a
/// [`Subagent`]. A workflow file that can't be read or doesn't parse is SKIPPED;
/// a malformed/partial AGENT row within an otherwise-valid file yields a partial
/// `Subagent` (or is dropped only when it has neither id nor label) — the rest of
/// the file is unaffected. Results are sorted by `(workflow_id, id)` for stable
/// output. A missing/unreadable `workflows/` dir yields an empty vec, never an
/// error. Never panics.
pub fn parse_session_subagents(session_dir: &Path, session_id: &str) -> Vec<Subagent> {
    let mut out = Vec::new();
    let workflows_dir = session_dir.join("workflows");
    let Ok(entries) = std::fs::read_dir(&workflows_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // Only top-level `*.json` run records; skip `scripts/` (a subdir, not a
        // file) and any non-json sibling.
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
        // The workflow id is the file stem (`wf_e4241c06-5ee.json` -> `wf_…`).
        let workflow_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue; // unreadable -> skip this run record, keep the rest.
        };
        let Ok(record) = serde_json::from_str::<WorkflowRecord>(&text) else {
            continue; // malformed JSON -> skip this run record, keep the rest.
        };
        for prog in record.workflow_progress {
            if let Some(sub) = prog.into_subagent(session_id, &workflow_id) {
                out.push(sub);
            }
        }
    }
    // (2) Standalone Task/Agent subagents recorded as bare sidecars directly under
    // `<session>/subagents/` (NOT under `subagents/workflows/`). The dominant case
    // in practice — most sessions spawn `Agent()`/`Task` subagents, not workflows.
    out.extend(parse_standalone_subagents(session_dir, session_id));
    // Stable order: by workflow id, then chronologically (started_at; unknown last),
    // then id as a final tiebreak. Workflow-less standalone subagents (None id) sort
    // ahead of any named workflow group and read newest-spawned-last.
    out.sort_by(|a, b| {
        a.workflow_id
            .cmp(&b.workflow_id)
            .then_with(|| cmp_started(a.started_at, b.started_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

/// Order two optional start times ascending, with a known time always sorting
/// before an unknown (`None`) one. Keeps chronological order within a group while
/// pushing timing-less rows to the end.
fn cmp_started(a: Option<i64>, b: Option<i64>) -> Ordering {
    match (a, b) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

// ---------------------------------------------------------------------------
// (1b) Standalone Task-tool subagents (bare sidecars, no workflow record).
// ---------------------------------------------------------------------------

/// The minimal per-subagent meta sidecar Claude writes for a standalone `Task`
/// agent: `{"agentType":"Explore","description":"…","toolUseId":"toolu_…"}`. All
/// fields optional/tolerant; an unreadable file is skipped, a malformed one yields
/// defaults (the row still surfaces by its filename id).
#[derive(Debug, Default, Deserialize)]
struct SubagentMeta {
    /// Human description of the task — used as the subagent's label.
    #[serde(default)]
    description: Option<String>,
    /// The agent type (e.g. `Explore`, `general-purpose`). Not surfaced as a field
    /// today (rows are label + status + duration), but read for completeness.
    #[serde(default, rename = "agentType")]
    #[allow(dead_code)]
    agent_type: Option<String>,
    /// The parent transcript `tool_use` id this subagent corresponds to — the join
    /// key used to decide whether the parent has recorded a result (done) or not.
    #[serde(default, rename = "toolUseId")]
    tool_use_id: Option<String>,
}

/// The parent transcript's tool state, scanned once per session: the set of `Task`
/// `tool_use` ids seen in the tail, and the set of `tool_use_id`s that already have
/// a `tool_result`. A standalone subagent is RUNNING iff its id is a pending
/// tool_use (present in `task_uses`, absent from `results`); otherwise DONE.
#[derive(Debug, Default)]
struct ParentToolState {
    task_uses: HashSet<String>,
    results: HashSet<String>,
}

/// Parse every standalone Task subagent under `<session_dir>/subagents/` (bare
/// `agent-<id>.meta.json` + sibling `agent-<id>.jsonl`), skipping the
/// `subagents/workflows/` subdir (those are workflow agents). Returns an empty vec
/// when the dir is absent or holds no bare metas — and only then pays for the
/// parent-transcript scan. Never panics.
fn parse_standalone_subagents(session_dir: &Path, session_id: &str) -> Vec<Subagent> {
    let subdir = session_dir.join("subagents");
    let Ok(entries) = std::fs::read_dir(&subdir) else {
        return Vec::new();
    };
    let metas: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.metadata().map(|m| m.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("agent-") && n.ends_with(".meta.json"))
        })
        .collect();
    if metas.is_empty() {
        return Vec::new();
    }
    // Only scan the parent transcript once we know there are standalone subagents.
    let parent = scan_parent_tool_state(session_dir, session_id);
    metas
        .iter()
        .filter_map(|meta_path| standalone_from_meta(meta_path, &subdir, session_id, &parent))
        .collect()
}

/// Build one [`Subagent`] from a bare meta sidecar at `meta_path` (id from the file
/// name), attributing it to `session_id`. Status is derived from `parent`; timing
/// from the sibling `agent-<id>.jsonl`. Returns `None` only when the id can't be
/// recovered or the meta file is unreadable.
fn standalone_from_meta(
    meta_path: &Path,
    subdir: &Path,
    session_id: &str,
    parent: &ParentToolState,
) -> Option<Subagent> {
    let name = meta_path.file_name()?.to_str()?;
    let id = name.strip_prefix("agent-")?.strip_suffix(".meta.json")?;
    if id.is_empty() {
        return None;
    }
    let text = std::fs::read_to_string(meta_path).ok()?;
    let meta: SubagentMeta = serde_json::from_str(&text).unwrap_or_default();

    let (first, last) = jsonl_span(&subdir.join(format!("agent-{id}.jsonl")));
    // RUNNING iff the parent shows a pending tool_use (seen, no result yet). A
    // subagent with no tool_use id, or whose id has a result / scrolled out of the
    // tail, is treated as finished.
    let running = match meta.tool_use_id.as_deref() {
        Some(tid) => parent.task_uses.contains(tid) && !parent.results.contains(tid),
        None => false,
    };
    let duration_ms = if running {
        None // still alive -> the UI ticks `now - started_at`.
    } else {
        match (first, last) {
            (Some(f), Some(l)) => Some((l - f).max(0)),
            _ => None,
        }
    };

    Some(Subagent {
        id: id.to_string(),
        label: non_empty(meta.description.as_deref()),
        status: Some(if running { "running" } else { "done" }.to_string()),
        model: None,
        usage: None,
        parent_session: session_id.to_string(),
        workflow_id: None,
        phase_title: None,
        phase_index: None,
        started_at: first,
        duration_ms,
    })
}

/// The first and last `timestamp` (unix millis) across a subagent transcript's
/// entries — the span used for "duration alive". Returns `(None, None)` for an
/// unreadable/empty file. Lines that aren't JSON or carry no parseable timestamp
/// are skipped.
fn jsonl_span(path: &Path) -> (Option<i64>, Option<i64>) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return (None, None);
    };
    let mut first = None;
    let mut last = None;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(ms) = v
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(crate::activity::parse_iso_millis)
        {
            if first.is_none() {
                first = Some(ms);
            }
            last = Some(ms);
        }
    }
    (first, last)
}

/// Scan the parent session transcript (`<project>/<session_id>.jsonl`, a bounded
/// tail) for the `Task` tool_use ids and the `tool_use_id`s that already have a
/// `tool_result`. A truncated first line from the tail cut simply fails to parse
/// and is skipped. Missing transcript -> empty state (everything reads as done).
fn scan_parent_tool_state(session_dir: &Path, session_id: &str) -> ParentToolState {
    let mut state = ParentToolState::default();
    let Some(project_dir) = session_dir.parent() else {
        return state;
    };
    let transcript = project_dir.join(format!("{session_id}.jsonl"));
    let Some(text) = read_tail(&transcript, PARENT_TAIL_BYTES) else {
        return state;
    };
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(content) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for block in content {
            match block.get("type").and_then(Value::as_str) {
                Some("tool_use") if block.get("name").and_then(Value::as_str) == Some("Task") => {
                    if let Some(id) = block.get("id").and_then(Value::as_str) {
                        state.task_uses.insert(id.to_string());
                    }
                }
                Some("tool_result") => {
                    if let Some(id) = block.get("tool_use_id").and_then(Value::as_str) {
                        state.results.insert(id.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    state
}

/// Read up to the last `max_bytes` of a file as a lossy UTF-8 string. `None` when
/// the file can't be opened/read. The leading partial line (from cutting mid-line)
/// is the caller's problem — JSONL parsing skips it.
fn read_tail(path: &Path, max_bytes: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(max_bytes))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

// ---------------------------------------------------------------------------
// (2) Project-dir encoding + multi-session lookup.
// ---------------------------------------------------------------------------

/// One session the frontend wants subagents for: its Claude `session_id` plus the
/// `cwd` the session runs in (used to locate its project dir). Serialized
/// camelCase for the JS side.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRef {
    /// The Claude session id (the `<session>` dir name under the project dir).
    pub session_id: String,
    /// The absolute working directory of the session, used to derive the Claude
    /// project-dir name. When `null`/absent the session is skipped (we can't
    /// locate its project dir without it).
    #[serde(default)]
    pub cwd: Option<String>,
}

/// Encode an absolute cwd the way Claude names its project dirs: every path
/// separator (`/`) becomes `-`. E.g. `/Users/arthur/git/agent-desktop` ->
/// `-Users-arthur-git-agent-desktop`. (Backslashes are mapped too, defensively.)
pub fn project_dir_for_cwd(cwd: &str) -> String {
    cwd.replace(['/', '\\'], "-")
}

/// Resolve the absolute project session dir for a session under `projects_base`
/// (normally `~/.claude/projects`): `<projects_base>/<encoded-cwd>/<session_id>`.
/// Returns `None` when `cwd` is absent or `session_id` could escape its parent
/// (contains a path separator or `..`).
fn session_dir(projects_base: &Path, ref_: &SessionRef) -> Option<PathBuf> {
    let cwd = ref_.cwd.as_deref()?;
    let session = safe_component(&ref_.session_id)?;
    let project = project_dir_for_cwd(cwd);
    Some(projects_base.join(project).join(session))
}

/// Reject a path component that could escape its parent (path separators or
/// `..`); otherwise return it unchanged.
fn safe_component(id: &str) -> Option<&str> {
    let t = id.trim();
    if t.is_empty() || t.contains('/') || t.contains('\\') || t.contains("..") {
        None
    } else {
        Some(t)
    }
}

/// Build the `session_id -> Vec<Subagent>` map for a set of sessions rooted at
/// `projects_base`. Sessions whose project dir can't be located (no cwd, unsafe
/// id) are simply absent from the map. A session with no subagents maps to an
/// empty vec (so the frontend can distinguish "looked, found none" from "didn't
/// ask"). Never panics.
pub fn subagents_for_sessions(
    projects_base: &Path,
    sessions: &[SessionRef],
) -> HashMap<String, Vec<Subagent>> {
    let mut map = HashMap::new();
    for ref_ in sessions {
        let Some(dir) = session_dir(projects_base, ref_) else {
            continue;
        };
        let subs = parse_session_subagents(&dir, &ref_.session_id);
        map.insert(ref_.session_id.clone(), subs);
    }
    map
}

/// Resolve the default Claude projects base (`~/.claude/projects`) from the
/// environment. `None` when `$HOME` is unset. Mirrors
/// [`crate::task::default_tasks_base`].
pub fn default_projects_base() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".claude").join("projects"))
}

// ---------------------------------------------------------------------------
// (3) Watcher over the projects base.
// ---------------------------------------------------------------------------

/// The shared set of sessions the watcher recomputes for, held behind a mutex so
/// the `subagents_for` command can update it without restarting the watch.
pub type WatchedSessions = Arc<Mutex<Vec<SessionRef>>>;

/// Owns the live `notify` watcher for the projects base. Dropping it stops the
/// watch (its own `Drop` tears down the platform backend + thread); held in
/// Tauri-managed state for the app's lifetime.
pub struct SubagentsWatcher {
    /// Kept so its `Drop` runs when this is dropped.
    _watcher: RecommendedWatcher,
    /// The projects base being watched (handy for diagnostics/tests).
    projects_base: PathBuf,
}

impl SubagentsWatcher {
    /// The projects base directory this watcher is watching.
    pub fn projects_base(&self) -> &Path {
        &self.projects_base
    }
}

/// The watcher's recompute-coalescing state (suppresses an identical map
/// re-emitted within [`COALESCE_WINDOW`] across a burst of fs events).
#[derive(Default)]
struct EmitState {
    last_emit: Option<(HashMap<String, Vec<Subagent>>, Instant)>,
}

/// Start watching `projects_base` (created if missing) recursively, invoking
/// `on_change` with the freshly-recomputed `session_id -> Vec<Subagent>` map on
/// every relevant fs change beneath it. `sessions` is the SHARED set the map is
/// computed for (read on every recompute) so the command can update which
/// sessions the app owns without restarting the watcher. The returned
/// [`SubagentsWatcher`] must be kept alive (dropping it stops the watch).
///
/// `on_change` runs on the watcher's event thread; it must be `Send`. In
/// production it emits the Tauri `overview://subagents` event; in tests it pushes
/// to a channel. Trivial duplicate recomputations are suppressed.
pub fn start_subagents_watcher<F>(
    projects_base: &Path,
    sessions: WatchedSessions,
    on_change: F,
) -> Result<SubagentsWatcher, String>
where
    F: Fn(HashMap<String, Vec<Subagent>>) + Send + 'static,
{
    // Ensure the base exists so `watch` doesn't fail before any project dir has
    // been created (fresh machine / first launch).
    std::fs::create_dir_all(projects_base)
        .map_err(|e| format!("create_dir_all {projects_base:?}: {e}"))?;

    let base_owned = projects_base.to_path_buf();
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
        // Snapshot the shared session set, then recompute against the filesystem.
        let sess = lock_sessions(&sessions);
        let map = subagents_for_sessions(&base_owned, &sess);
        drop(sess);
        // Coalesce: suppress an identical map re-emitted within the window.
        let mut guard = match emit.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let now = Instant::now();
        if let Some((last, when)) = &guard.last_emit {
            if *last == map && now.duration_since(*when) < COALESCE_WINDOW {
                return;
            }
        }
        guard.last_emit = Some((map.clone(), now));
        drop(guard);
        on_change(map);
    })
    .map_err(|e| format!("recommended_watcher: {e}"))?;

    watcher
        .watch(projects_base, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {projects_base:?}: {e}"))?;

    Ok(SubagentsWatcher {
        _watcher: watcher,
        projects_base: projects_base.to_path_buf(),
    })
}

/// Lock the shared session set, recovering from poisoning (a prior panic on
/// another thread must not wedge the watcher).
fn lock_sessions(set: &WatchedSessions) -> std::sync::MutexGuard<'_, Vec<SessionRef>> {
    match set.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A throwaway dir under the system temp dir, removed on drop. Mirrors the
    /// helper in [`crate::usage`]/[`crate::task`] tests.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-subagents-{tag}-{nanos}"));
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

    /// Build a session project dir layout under `base`:
    /// `<base>/<project>/<session>/{workflows,subagents/workflows/<wf>}`.
    /// Returns the session dir. Mirrors the REAL on-disk layout discovered under
    /// `~/.claude/projects/-Users-…/<session>/`.
    fn make_session(base: &Path, project: &str, session: &str) -> PathBuf {
        let dir = base.join(project).join(session);
        std::fs::create_dir_all(dir.join("workflows")).unwrap();
        dir
    }

    /// Write a workflow run record file with the given `workflowProgress` JSON
    /// (the array body, e.g. `[{...},{...}]`) under `<session>/workflows/<wf>.json`,
    /// wrapped in a realistic envelope of sibling fields we deliberately ignore.
    fn write_workflow(session_dir: &Path, wf_id: &str, progress_json: &str) {
        let body = format!(
            r#"{{"runId":"{wf_id}","status":"completed","agentCount":2,
                 "defaultModel":"claude-opus-4-8[1m]","summary":"x",
                 "workflowProgress":{progress_json}}}"#
        );
        std::fs::write(
            session_dir.join("workflows").join(format!("{wf_id}.json")),
            body,
        )
        .unwrap();
    }

    /// Write the minimal per-subagent meta sidecar the way Claude does
    /// (`{"agentType":"workflow-subagent"}`) under
    /// `subagents/workflows/<wf>/agent-<id>.meta.json`.
    fn write_meta(session_dir: &Path, wf_id: &str, agent_id: &str) {
        let dir = session_dir.join("subagents").join("workflows").join(wf_id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("agent-{agent_id}.meta.json")),
            r#"{"agentType":"workflow-subagent"}"#,
        )
        .unwrap();
    }

    /// Write a bare standalone-Task meta sidecar
    /// (`subagents/agent-<id>.meta.json`) the way Claude does for an `Agent()` call.
    fn write_standalone_meta(session_dir: &Path, agent_id: &str, desc: &str, tool_use_id: &str) {
        let dir = session_dir.join("subagents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("agent-{agent_id}.meta.json")),
            format!(
                r#"{{"agentType":"Explore","description":"{desc}","toolUseId":"{tool_use_id}"}}"#
            ),
        )
        .unwrap();
    }

    /// Write a standalone subagent transcript (`subagents/agent-<id>.jsonl`) with
    /// one entry per supplied ISO timestamp (the first/last drive duration).
    fn write_standalone_jsonl(session_dir: &Path, agent_id: &str, timestamps: &[&str]) {
        let dir = session_dir.join("subagents");
        std::fs::create_dir_all(&dir).unwrap();
        let body: String = timestamps
            .iter()
            .map(|ts| format!(r#"{{"type":"assistant","timestamp":"{ts}"}}"#))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(dir.join(format!("agent-{agent_id}.jsonl")), body).unwrap();
    }

    /// Write the PARENT session transcript (`<project>/<session>.jsonl`, sibling of
    /// the session dir) from raw JSONL lines.
    fn write_parent_transcript(session_dir: &Path, session_id: &str, lines: &[&str]) {
        let parent = session_dir.parent().unwrap();
        std::fs::write(
            parent.join(format!("{session_id}.jsonl")),
            lines.join("\n"),
        )
        .unwrap();
    }

    /// A parent `tool_use` line for a `Task` with the given id.
    fn task_use_line(tool_id: &str) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"{tool_id}","name":"Task","input":{{}}}}]}}}}"#
        )
    }

    /// A parent `tool_result` line completing the given tool_use id.
    fn tool_result_line(tool_id: &str) -> String {
        format!(
            r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"{tool_id}","content":"ok"}}]}}}}"#
        )
    }

    /// Spec scenario: "Standalone Task subagents appear under their parent agent".
    /// A session with a bare `agent-<id>.meta.json` + `.jsonl` (no workflow record)
    /// surfaces a FLAT subagent: label from `description`, started_at from the first
    /// jsonl timestamp, and (since the parent recorded a result) status `done` with a
    /// duration spanning the jsonl.
    #[test]
    fn standalone_task_subagents_appear_under_their_parent_agent() {
        let tmp = TempDir::new("standalone");
        let session = make_session(tmp.path(), "-Users-arthur-git-app", "sess-S");
        write_standalone_meta(&session, "a84539", "Implement auto-update integration", "toolu_1");
        let first = "2026-06-13T19:39:14.406Z";
        let last = "2026-06-13T19:41:22.169Z";
        write_standalone_jsonl(&session, "a84539", &[first, last]);
        // Parent recorded the Task AND its result -> the subagent is finished.
        write_parent_transcript(
            &session,
            "sess-S",
            &[&task_use_line("toolu_1"), &tool_result_line("toolu_1")],
        );

        let subs = parse_session_subagents(&session, "sess-S");
        assert_eq!(subs.len(), 1, "the one standalone subagent surfaces");
        let s = &subs[0];
        assert_eq!(s.id, "a84539");
        assert_eq!(s.label.as_deref(), Some("Implement auto-update integration"));
        assert_eq!(s.parent_session, "sess-S");
        assert!(s.workflow_id.is_none(), "standalone -> no workflow (flat/ungrouped)");
        assert!(s.phase_title.is_none(), "standalone -> no phase");
        assert_eq!(s.status.as_deref(), Some("done"), "parent recorded a result");

        let f = crate::activity::parse_iso_millis(first).unwrap();
        let l = crate::activity::parse_iso_millis(last).unwrap();
        assert_eq!(s.started_at, Some(f));
        assert_eq!(s.duration_ms, Some(l - f), "duration spans the jsonl");
    }

    /// Spec scenario: "Standalone subagent status reflects the parent result".
    /// Two standalone subagents share a session: one whose tool_use has a matching
    /// `tool_result` in the parent (-> done, with a settled duration), and one whose
    /// `tool_use` is still pending with no result (-> running, duration left to the
    /// UI's live `now - startedAt`).
    #[test]
    fn standalone_subagent_status_reflects_the_parent_result() {
        let tmp = TempDir::new("standalone-status");
        let session = make_session(tmp.path(), "-Users-arthur-git-app", "sess-T");
        write_standalone_meta(&session, "adone", "finished task", "toolu_done");
        write_standalone_jsonl(
            &session,
            "adone",
            &["2026-06-13T10:00:00.000Z", "2026-06-13T10:00:30.000Z"],
        );
        write_standalone_meta(&session, "arun", "live task", "toolu_run");
        write_standalone_jsonl(&session, "arun", &["2026-06-13T10:01:00.000Z"]);
        // Parent: both Tasks were launched; only the first has a result.
        write_parent_transcript(
            &session,
            "sess-T",
            &[
                &task_use_line("toolu_done"),
                &task_use_line("toolu_run"),
                &tool_result_line("toolu_done"),
            ],
        );

        let subs = parse_session_subagents(&session, "sess-T");
        let done = subs.iter().find(|s| s.id == "adone").unwrap();
        let run = subs.iter().find(|s| s.id == "arun").unwrap();

        assert_eq!(done.status.as_deref(), Some("done"), "has a tool_result");
        assert_eq!(done.duration_ms, Some(30_000), "settled 30s duration");

        assert_eq!(run.status.as_deref(), Some("running"), "pending, no result");
        assert!(run.started_at.is_some(), "running row still carries a start time");
        assert!(
            run.duration_ms.is_none(),
            "running -> no settled duration (UI ticks now - startedAt)"
        );
    }

    /// A standalone subagent whose meta JSON is malformed still surfaces by its
    /// filename id (label/status best-effort), and an unreadable jsonl just yields
    /// no timing — the row is never dropped, and the rest of the session is intact.
    #[test]
    fn standalone_malformed_meta_is_tolerated() {
        let tmp = TempDir::new("standalone-bad");
        let session = make_session(tmp.path(), "-Users-arthur-git-app", "sess-U");
        let dir = session.join("subagents");
        std::fs::create_dir_all(&dir).unwrap();
        // Truncated/invalid JSON meta + no jsonl at all.
        std::fs::write(dir.join("agent-abad.meta.json"), r#"{"description":"oops"#).unwrap();

        let subs = parse_session_subagents(&session, "sess-U");
        assert_eq!(subs.len(), 1, "malformed meta still surfaces a row");
        assert_eq!(subs[0].id, "abad");
        assert!(subs[0].label.is_none(), "unparseable meta -> no label");
        assert!(subs[0].started_at.is_none(), "no jsonl -> no timing");
    }

    /// Spec scenario: "Subagents appear under their parent agent".
    /// A session with a workflow run record (plus a couple meta sidecars) yields
    /// one [`Subagent`] per `workflow_agent` entry, each carrying its label and
    /// status (and model/usage where present), attributed to the parent session.
    #[test]
    fn subagents_appear_under_their_parent_agent() {
        let tmp = TempDir::new("appear");
        let session = make_session(tmp.path(), "-Users-arthur-git-app", "sess-1");
        // A realistic workflowProgress: a phase row (ignored) + two agent rows.
        write_workflow(
            &session,
            "wf_aaa",
            r#"[
                {"type":"workflow_phase","index":1,"title":"Capabilities"},
                {"type":"workflow_agent","index":1,"label":"spec:terminal-core",
                 "agentId":"a45490d0ade2c7a7c","model":"claude-opus-4-8[1m]",
                 "state":"done","tokens":22423,"toolCalls":2,"durationMs":41710,
                 "phaseIndex":1,"phaseTitle":"Capabilities","startedAt":1780373405182},
                {"type":"workflow_agent","index":2,"label":"spec:tiling-layout",
                 "agentId":"aafb262f94f1397db","model":"claude-opus-4-8[1m]",
                 "state":"running","tokens":12000}
            ]"#,
        );
        write_meta(&session, "wf_aaa", "a45490d0ade2c7a7c");
        write_meta(&session, "wf_aaa", "aafb262f94f1397db");

        let subs = parse_session_subagents(&session, "sess-1");
        assert_eq!(
            subs.len(),
            2,
            "one per workflow_agent row; phase row ignored"
        );

        // Sorted by (workflow_id, id) -> deterministic order.
        let first = &subs[0];
        assert_eq!(first.id, "a45490d0ade2c7a7c");
        assert_eq!(first.label.as_deref(), Some("spec:terminal-core"));
        assert_eq!(first.status.as_deref(), Some("done"));
        assert_eq!(first.model.as_deref(), Some("claude-opus-4-8[1m]"));
        assert_eq!(first.parent_session, "sess-1");
        assert_eq!(first.workflow_id.as_deref(), Some("wf_aaa"));
        assert_eq!(
            first.usage,
            Some(SubagentUsage {
                cost: None,
                tokens: Some(22423),
                context_pct: None
            })
        );
        // Phase + timing fields are surfaced when the agent row carries them.
        assert_eq!(first.phase_title.as_deref(), Some("Capabilities"));
        assert_eq!(first.phase_index, Some(1));
        assert_eq!(first.started_at, Some(1780373405182));
        assert_eq!(first.duration_ms, Some(41710));

        let second = &subs[1];
        assert_eq!(second.id, "aafb262f94f1397db");
        assert_eq!(second.label.as_deref(), Some("spec:tiling-layout"));
        assert_eq!(second.status.as_deref(), Some("running"));
        assert_eq!(second.usage.unwrap().tokens, Some(12000));
        // A row that omits the phase/timing fields parses them to None.
        assert!(second.phase_title.is_none(), "no phaseTitle -> null");
        assert!(second.phase_index.is_none(), "no phaseIndex -> null");
        assert!(second.started_at.is_none(), "no startedAt -> null");
        assert!(second.duration_ms.is_none(), "no durationMs -> null");
    }

    /// Spec scenario: "Partial subagent metadata does not break the roster".
    /// Within one session, an agent row with a missing field (no id, only a label),
    /// a wholly malformed workflow file, and an empty/garbage agent row are each
    /// skipped-or-partial; the VALID rows in the rest of the session survive intact.
    #[test]
    fn partial_subagent_metadata_does_not_break_the_roster() {
        let tmp = TempDir::new("partial");
        let session = make_session(tmp.path(), "-Users-arthur-git-app", "sess-2");

        // wf_ok: one fully-valid row + one PARTIAL row (no agentId, no model, no
        // usage — only a label) -> partial Subagent (id derived from label), not
        // dropped. Plus a junk row that has neither id nor label -> dropped.
        write_workflow(
            &session,
            "wf_ok",
            r#"[
                {"type":"workflow_agent","label":"good","agentId":"agood","state":"done","tokens":5},
                {"type":"workflow_agent","label":"only-label"},
                {"type":"workflow_agent","state":"done"}
            ]"#,
        );
        // wf_bad: not valid JSON at all -> the whole file is skipped, the rest of
        // the session (wf_ok) is unaffected.
        std::fs::write(
            session.join("workflows").join("wf_bad.json"),
            r#"{"workflowProgress":[{"type":"workflow_agent","#,
        )
        .unwrap();

        let subs = parse_session_subagents(&session, "sess-2");
        let ids: Vec<&str> = subs.iter().map(|s| s.id.as_str()).collect();
        // The valid row and the partial (label-only) row survive; the id-less,
        // label-less junk row and the entire malformed file are dropped.
        assert!(ids.contains(&"agood"), "valid row survives");
        assert!(
            ids.contains(&"only-label"),
            "label-only row surfaces partially"
        );
        assert_eq!(
            subs.len(),
            2,
            "junk row + malformed file dropped, rest intact"
        );

        let partial = subs.iter().find(|s| s.id == "only-label").unwrap();
        assert_eq!(partial.label.as_deref(), Some("only-label"));
        assert!(partial.status.is_none(), "no state -> null status");
        assert!(partial.model.is_none(), "no model -> null model");
        assert!(partial.usage.is_none(), "no usage fields -> null usage");

        let good = subs.iter().find(|s| s.id == "agood").unwrap();
        assert_eq!(good.usage.unwrap().tokens, Some(5));
    }

    /// A missing `workflows/` dir (a session that never spawned subagents) yields
    /// an empty list, not an error.
    #[test]
    fn missing_workflows_dir_is_empty() {
        let tmp = TempDir::new("nowf");
        let dir = tmp.path().join("-Users-x").join("sess-x");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(parse_session_subagents(&dir, "sess-x").is_empty());
    }

    /// `project_dir_for_cwd` encodes a cwd the way Claude names its project dirs
    /// (every `/` -> `-`, including the leading separator).
    #[test]
    fn project_dir_encoding_matches_claude() {
        assert_eq!(
            project_dir_for_cwd("/Users/arthur/git/agent-desktop"),
            "-Users-arthur-git-agent-desktop"
        );
    }

    /// `subagents_for_sessions` builds the per-session map, resolving each
    /// session's project dir from its cwd, and skips a session that supplies no
    /// cwd (we can't locate its project dir). A session with no subagents maps to
    /// an empty vec.
    #[test]
    fn subagents_for_sessions_maps_by_session() {
        let tmp = TempDir::new("multi");
        let base = tmp.path();
        // Session A: has a subagent. Its project dir is the encoded cwd.
        let cwd_a = "/work/a";
        let proj_a = project_dir_for_cwd(cwd_a); // "-work-a"
        let dir_a = make_session(base, &proj_a, "sess-A");
        write_workflow(
            &dir_a,
            "wf_a",
            r#"[{"type":"workflow_agent","label":"sub","agentId":"a1","state":"done"}]"#,
        );
        // Session B: project dir exists but no workflows -> empty vec.
        make_session(base, &project_dir_for_cwd("/work/b"), "sess-B");

        let sessions = vec![
            SessionRef {
                session_id: "sess-A".into(),
                cwd: Some(cwd_a.into()),
            },
            SessionRef {
                session_id: "sess-B".into(),
                cwd: Some("/work/b".into()),
            },
            // No cwd -> skipped entirely (absent from the map).
            SessionRef {
                session_id: "sess-C".into(),
                cwd: None,
            },
        ];
        let map = subagents_for_sessions(base, &sessions);

        assert_eq!(
            map.get("sess-A").map(|v| v.len()),
            Some(1),
            "A has one subagent"
        );
        assert_eq!(map["sess-A"][0].id, "a1");
        assert_eq!(map["sess-A"][0].parent_session, "sess-A");
        assert_eq!(
            map.get("sess-B").map(|v| v.len()),
            Some(0),
            "B looked, found none"
        );
        assert!(!map.contains_key("sess-C"), "no-cwd session is skipped");
    }

    /// A session id that could escape its parent dir (path separator) is rejected,
    /// so the session is skipped rather than reading an arbitrary path.
    #[test]
    fn unsafe_session_id_is_skipped() {
        let tmp = TempDir::new("unsafe");
        let sessions = vec![SessionRef {
            session_id: "../../etc".into(),
            cwd: Some("/work/a".into()),
        }];
        let map = subagents_for_sessions(tmp.path(), &sessions);
        assert!(map.is_empty(), "unsafe id resolves to no dir -> skipped");
    }

    /// End-to-end: the watcher recomputes and pushes the per-session map when a
    /// workflow record is written under a watched session's project dir; an
    /// unwatched session's writes produce a map that simply omits it. Exercises
    /// the real `notify` backend headlessly (the live in-app wiring is the only
    /// MANUAL aspect).
    #[test]
    fn watcher_emits_map_on_workflow_write() {
        let tmp = TempDir::new("watch");
        let base = tmp.path();
        let cwd = "/work/w";
        let session = make_session(base, &project_dir_for_cwd(cwd), "sess-W");

        let watched: WatchedSessions = Arc::new(Mutex::new(vec![SessionRef {
            session_id: "sess-W".into(),
            cwd: Some(cwd.into()),
        }]));

        let (tx, rx) = mpsc::channel::<HashMap<String, Vec<Subagent>>>();
        let watcher = start_subagents_watcher(base, watched, move |map| {
            let _ = tx.send(map);
        })
        .expect("watcher starts");
        assert_eq!(watcher.projects_base(), base);

        // Write a workflow record under the watched session: a recompute fires.
        write_workflow(
            &session,
            "wf_w",
            r#"[{"type":"workflow_agent","label":"sub","agentId":"aw","state":"done","tokens":9}]"#,
        );

        // Drain until we observe the session populated (coalesced bursts may send
        // intermediate maps first).
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        let mut got = None;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(map) => {
                    if map.get("sess-W").map(|v| !v.is_empty()).unwrap_or(false) {
                        got = Some(map);
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(_) => break,
            }
        }
        let map = got.expect("watcher must push a map with the new subagent");
        assert_eq!(map["sess-W"][0].id, "aw");
        assert_eq!(map["sess-W"][0].usage.unwrap().tokens, Some(9));

        drop(watcher); // stops the watch cleanly.
    }
}
