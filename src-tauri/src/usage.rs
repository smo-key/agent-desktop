//! Snapshot-directory watcher for the `usage-dashboard` capability (Milestone 3).
//!
//! The statusline wrapper writes one atomic (tmp+rename) JSON file per pane to
//! `<app-support>/snapshots/<pane_id>.json` on every render (see
//! `resources/statusline-wrapper.cjs`). This module watches that directory with
//! the `notify` crate and, on every create/modify, parses the changed file and
//! pushes the parsed [`Snapshot`] to the frontend as a Tauri event
//! (`usage://snapshot`). Malformed/partial files are SKIPPED (parse errors are
//! ignored), so the watcher never observes a truncated file as data: the wrapper
//! renames into place, and any JSON that fails to parse is simply dropped until
//! the next valid write.
//!
//! On startup the caller can read the current set via [`read_all_snapshots`]
//! (exposed to the frontend through the `usage_snapshots` command) so a pane that
//! already has a snapshot is rendered immediately, before any new fs event fires.
//!
//! The [`SnapshotWatcher`] owns the live `notify` watcher; dropping it stops the
//! watch cleanly (the watcher's own `Drop` tears down the platform backend and
//! joins its thread). It is held in Tauri-managed state for the app's lifetime.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

/// The Tauri event name the watcher emits each parsed snapshot on. The frontend
/// `snapshots` store listens on exactly this name.
pub const SNAPSHOT_EVENT: &str = "usage://snapshot";

/// Coalescing window: an identical `(pane, ts)` snapshot re-observed within this
/// span is treated as a trivial duplicate and not re-emitted. macOS FSEvents (and
/// editors/tools) frequently fire several events for one logical write; this
/// keeps us from pushing the same snapshot to the frontend many times in a row.
const COALESCE_WINDOW: Duration = Duration::from_millis(250);

/// The git sub-object embedded in every snapshot. Always present (the wrapper
/// emits a stable `{branch, dirty}` shape); individual fields are `null` when
/// git can't answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitStatus {
    /// Current branch (abbrev ref), or `null`.
    #[serde(default)]
    pub branch: Option<String>,
    /// Whether the worktree is dirty, or `null` when git couldn't answer.
    #[serde(default)]
    pub dirty: Option<bool>,
    /// Number of changed paths in the worktree, or `null` when git couldn't answer.
    #[serde(default)]
    pub modified: Option<i64>,
    /// Commits ahead of the upstream branch (not yet pushed), or `null`.
    #[serde(default)]
    pub ahead: Option<i64>,
    /// Commits behind `origin/main`, or `null`.
    #[serde(default)]
    pub behind: Option<i64>,
}

/// A per-pane usage snapshot, mirroring the JSON the statusline wrapper writes.
///
/// Field names are kept snake_case (no rename) so the (de)serialized wire shape
/// is byte-for-byte the wrapper's output and the frontend store keys on the same
/// `pane_id`. The only REQUIRED field is `pane_id` (it is the map key); every
/// other field deserializes to its `null`/default when absent so a slightly
/// older/newer wrapper schema still parses. `rate_limits` is an opaque
/// account-global object (or `null`) passed through verbatim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    /// The pane uuid — the snapshot's filename key and the frontend map key.
    pub pane_id: String,
    /// The Claude session id (or `null`); guarded against path separators by the
    /// wrapper. The pane card keys on `pane_id`, not this, so a resume/fork that
    /// changes `session_id` does not orphan the card.
    #[serde(default)]
    pub session_id: Option<String>,
    /// `model.display_name`, or `null`.
    #[serde(default)]
    pub model: Option<String>,
    /// The detected in-progress task label, or `null`.
    #[serde(default)]
    pub task: Option<String>,
    /// Context window usage 0..100, or `null` when unknown.
    #[serde(default)]
    pub context_pct: Option<f64>,
    /// Account-global rate-limit object verbatim, or `null` when absent.
    #[serde(default)]
    pub rate_limits: Option<serde_json::Value>,
    /// Total session cost in USD, or `null`.
    #[serde(default)]
    pub cost: Option<f64>,
    /// Git branch + dirty for the workspace dir.
    #[serde(default)]
    pub git: Option<GitStatus>,
    /// Unix timestamp (SECONDS) the snapshot was written — drives the live/idle
    /// heartbeat and "newest snapshot" rate-limit selection.
    #[serde(default)]
    pub ts: i64,
}

/// Parse a single snapshot file. Returns `None` (silently) when the file can't
/// be read or doesn't parse as a [`Snapshot`] — i.e. a malformed/partial file is
/// SKIPPED rather than surfaced. A snapshot missing `pane_id` fails to parse and
/// is likewise skipped, so the frontend never receives an unkeyed card.
pub fn read_snapshot(path: &Path) -> Option<Snapshot> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Snapshot>(&text).ok()
}

/// Read every `*.json` snapshot currently in `dir`, skipping any that don't parse
/// (malformed/partial) and any non-`.json` entries (including the wrapper's
/// dot-prefixed `.tmp` siblings). Used to SEED the frontend on launch so existing
/// panes render before the first fs event. A missing/unreadable dir yields an
/// empty vec.
pub fn read_all_snapshots(dir: &Path) -> Vec<Snapshot> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // Only `<pane>.json` files; the wrapper's temp siblings are dot-prefixed
        // and use a `.tmp` extension, so this skips them.
        let is_json = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"));
        if !is_json {
            continue;
        }
        if let Some(snap) = read_snapshot(&path) {
            out.push(snap);
        }
    }
    out
}

/// Whether a watch event is one we should react to: a create or modify touching
/// a path. (Renames-into-place land as a Create/Modify on the destination, which
/// is what the atomic tmp+rename write produces.) Removes are ignored — a pane's
/// last snapshot stays rendered until the app exits.
fn is_relevant(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(_))
}

/// Trivial-duplicate coalescer keyed on `pane_id`. Suppresses re-emitting the
/// same `(pane, ts)` snapshot within [`COALESCE_WINDOW`] — macOS fires several
/// fs events per logical write and a tmp+rename can surface as both a Create and
/// a Modify on the destination. A snapshot with a NEW `ts` (a real new render)
/// always passes, so we never drop genuine updates.
#[derive(Default)]
struct Coalescer {
    last: HashMap<String, (i64, Instant)>,
}

impl Coalescer {
    /// Returns true if this snapshot should be emitted (i.e. it is not a trivial
    /// duplicate of the immediately-preceding emit for the same pane).
    fn should_emit(&mut self, snap: &Snapshot) -> bool {
        let now = Instant::now();
        if let Some((ts, when)) = self.last.get(&snap.pane_id) {
            if *ts == snap.ts && now.duration_since(*when) < COALESCE_WINDOW {
                return false;
            }
        }
        self.last.insert(snap.pane_id.clone(), (snap.ts, now));
        true
    }
}

/// Owns the live `notify` watcher for the snapshot dir. Dropping it stops the
/// watch (the watcher's `Drop` tears down the platform backend + thread), so the
/// app holds exactly one in managed state for its lifetime and a clean exit
/// releases it deterministically.
pub struct SnapshotWatcher {
    /// The platform watcher. `None` only if construction failed (logged by the
    /// caller); kept boxed in an `Option` so the field stays `Send + 'static`.
    _watcher: RecommendedWatcher,
    /// The directory being watched (handy for diagnostics/tests).
    dir: PathBuf,
}

impl SnapshotWatcher {
    /// The directory this watcher is watching.
    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// Start watching `dir` (created if missing), invoking `on_snapshot` for every
/// parsed snapshot from a create/modify event. Trivial duplicate events are
/// coalesced. Malformed/partial files are skipped (no callback). Returns the
/// [`SnapshotWatcher`] the caller must keep alive — dropping it stops the watch.
///
/// `on_snapshot` runs on the watcher's own event thread; it must be `Send`. In
/// production it emits the Tauri `usage://snapshot` event; in tests it pushes to
/// a channel.
pub fn start_snapshot_watcher<F>(dir: &Path, on_snapshot: F) -> Result<SnapshotWatcher, String>
where
    F: Fn(Snapshot) + Send + 'static,
{
    // Ensure the dir exists so `watch` doesn't fail before the wrapper has ever
    // written into it (first launch, before any session renders).
    std::fs::create_dir_all(dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;

    let coalescer = Mutex::new(Coalescer::default());

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else {
            return; // watch error: ignore, keep watching.
        };
        if !is_relevant(&event.kind) {
            return;
        }
        for path in &event.paths {
            // Only react to `<pane>.json` files; skip the wrapper's dot-prefixed
            // `.tmp` siblings so a half-written temp never even gets read.
            let is_json = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("json"));
            if !is_json {
                continue;
            }
            // Read + parse; malformed/partial -> skip (None), nothing emitted.
            let Some(snap) = read_snapshot(path) else {
                continue;
            };
            // Coalesce trivial duplicates (same pane + ts within the window).
            let emit = coalescer
                .lock()
                .map(|mut c| c.should_emit(&snap))
                .unwrap_or(true);
            if emit {
                on_snapshot(snap);
            }
        }
    })
    .map_err(|e| format!("recommended_watcher: {e}"))?;

    watcher
        .watch(dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch {dir:?}: {e}"))?;

    Ok(SnapshotWatcher {
        _watcher: watcher,
        dir: dir.to_path_buf(),
    })
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
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-usage-{tag}-{nanos}"));
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

    fn write_json(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    /// A full snapshot parses into the typed struct with every field populated,
    /// preserving the opaque `rate_limits` object verbatim.
    #[test]
    fn read_snapshot_parses_full_shape() {
        let tmp = TempDir::new("full");
        write_json(
            tmp.path(),
            "pane-1.json",
            r#"{
                "pane_id":"pane-1","session_id":"sess-1","model":"Claude Opus",
                "task":"Refactoring the watcher","context_pct":42.5,
                "rate_limits":{"five_hour":{"used_percentage":10}},
                "cost":1.25,"git":{"branch":"main","dirty":true,"ahead":2,"behind":0},"ts":1717200000
            }"#,
        );
        let snap = read_snapshot(&tmp.path().join("pane-1.json")).expect("must parse");
        assert_eq!(snap.pane_id, "pane-1");
        assert_eq!(snap.session_id.as_deref(), Some("sess-1"));
        assert_eq!(snap.model.as_deref(), Some("Claude Opus"));
        assert_eq!(snap.task.as_deref(), Some("Refactoring the watcher"));
        assert_eq!(snap.context_pct, Some(42.5));
        assert_eq!(snap.cost, Some(1.25));
        assert_eq!(
            snap.git,
            Some(GitStatus {
                branch: Some("main".into()),
                dirty: Some(true),
                modified: None,
                ahead: Some(2),
                behind: Some(0)
            })
        );
        assert_eq!(snap.ts, 1_717_200_000);
        // rate_limits passes through verbatim as an opaque object.
        assert_eq!(
            snap.rate_limits.unwrap()["five_hour"]["used_percentage"],
            serde_json::json!(10)
        );
    }

    /// A snapshot with absent optional fields (null rate_limits/context, etc.)
    /// still parses; only `pane_id` is required.
    #[test]
    fn read_snapshot_tolerates_absent_optionals() {
        let tmp = TempDir::new("sparse");
        write_json(
            tmp.path(),
            "pane-2.json",
            r#"{"pane_id":"pane-2","session_id":null,"model":null,"task":null,
                "context_pct":null,"rate_limits":null,"cost":null,
                "git":{"branch":null,"dirty":null},"ts":1717200001}"#,
        );
        let snap = read_snapshot(&tmp.path().join("pane-2.json")).expect("must parse");
        assert_eq!(snap.pane_id, "pane-2");
        assert!(snap.rate_limits.is_none());
        assert!(snap.context_pct.is_none());
        assert_eq!(
            snap.git,
            Some(GitStatus {
                branch: None,
                dirty: None,
                modified: None,
                ahead: None,
                behind: None
            })
        );
    }

    /// A malformed / partial file is SKIPPED (returns None) rather than erroring,
    /// and `read_all_snapshots` drops it while keeping the valid ones.
    #[test]
    fn malformed_snapshot_skipped() {
        let tmp = TempDir::new("malformed");
        // valid
        write_json(tmp.path(), "good.json", r#"{"pane_id":"good","ts":1}"#);
        // truncated / partial JSON (as a reader might see mid-write, though the
        // wrapper's rename prevents this) -> must be skipped.
        write_json(tmp.path(), "partial.json", r#"{"pane_id":"part","ts"#);
        // JSON object but missing the required pane_id -> must be skipped.
        write_json(tmp.path(), "nokey.json", r#"{"model":"x","ts":2}"#);
        // a dot-prefixed .tmp sibling the wrapper would leave mid-write -> ignored
        // by extension filter.
        write_json(tmp.path(), ".good.123.tmp", r#"{"pane_id":"tmp","ts":3}"#);

        assert!(read_snapshot(&tmp.path().join("partial.json")).is_none());
        assert!(read_snapshot(&tmp.path().join("nokey.json")).is_none());

        let all = read_all_snapshots(tmp.path());
        let ids: Vec<&str> = all.iter().map(|s| s.pane_id.as_str()).collect();
        assert_eq!(ids, vec!["good"], "only the one valid .json snapshot");
    }

    /// `read_all_snapshots` on a missing dir is empty, not an error.
    #[test]
    fn read_all_snapshots_missing_dir_is_empty() {
        let tmp = TempDir::new("missing");
        let missing = tmp.path().join("does-not-exist");
        assert!(read_all_snapshots(&missing).is_empty());
    }

    /// The coalescer suppresses an identical `(pane, ts)` re-emit but always
    /// passes a snapshot with a new `ts` (a genuine new render).
    #[test]
    fn coalescer_suppresses_duplicate_ts_only() {
        let mut c = Coalescer::default();
        let mk = |pane: &str, ts: i64| Snapshot {
            pane_id: pane.into(),
            session_id: None,
            model: None,
            task: None,
            context_pct: None,
            rate_limits: None,
            cost: None,
            git: None,
            ts,
        };
        assert!(c.should_emit(&mk("a", 100)), "first ever emits");
        assert!(!c.should_emit(&mk("a", 100)), "same (pane, ts) coalesced");
        assert!(c.should_emit(&mk("a", 101)), "new ts emits");
        assert!(c.should_emit(&mk("b", 100)), "different pane emits");
    }

    /// End-to-end: the watcher reads a newly-written snapshot file and pushes the
    /// parsed snapshot to the callback; a malformed file fires no callback. This
    /// exercises the real notify backend (the integration the spec marks MANUAL
    /// at the app level, covered headlessly here at the module level).
    #[test]
    fn watcher_emits_parsed_snapshot_on_write() {
        let tmp = TempDir::new("watch");
        let (tx, rx) = mpsc::channel::<Snapshot>();
        let tx = Arc::new(tx);
        let watcher = start_snapshot_watcher(tmp.path(), move |snap| {
            let _ = tx.send(snap);
        })
        .expect("watcher starts");
        assert_eq!(watcher.dir(), tmp.path());

        // Atomic write the way the wrapper does: tmp sibling + rename into place.
        let target = tmp.path().join("pane-w.json");
        let tmpf = tmp.path().join(".pane-w.tmp");
        std::fs::write(&tmpf, r#"{"pane_id":"pane-w","model":"M","ts":7}"#).unwrap();
        std::fs::rename(&tmpf, &target).unwrap();

        // The valid snapshot arrives.
        let got = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("snapshot must be pushed");
        assert_eq!(got.pane_id, "pane-w");
        assert_eq!(got.model.as_deref(), Some("M"));
        assert_eq!(got.ts, 7);

        // A malformed write fires no callback (nothing to receive within a short
        // grace window).
        let bad_tmp = tmp.path().join(".bad.tmp");
        std::fs::write(&bad_tmp, r#"{"pane_id":"bad","#).unwrap();
        std::fs::rename(&bad_tmp, tmp.path().join("bad.json")).unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "malformed file must not push a snapshot"
        );

        drop(watcher); // stops the watch cleanly.
    }
}
