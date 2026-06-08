//! Per-PROJECT git status for the project pane.
//!
//! The footer's git pills ride the statusline snapshot of a RUNNING agent's pane.
//! The project pane, by contrast, wants each project's branch/ahead/behind/dirty
//! even when no agent is running in it — so this module shells out to `git`
//! directly against each project FOLDER. It mirrors the statusline wrapper's git
//! logic (`resources/statusline-wrapper.cjs`): branch via `rev-parse`, dirty via
//! `status --porcelain`, `behind` vs `origin/main`, `ahead` vs the upstream branch.
//! Every field is null when git can't answer (off-repo / no remote / no upstream),
//! so the shape is always stable and the call never fails the UI.
//!
//! Each requested path is probed on its own thread so total latency tracks the
//! slowest single repo rather than their sum; the frontend POLLS the
//! [`git_status_for`] command on a slow clock.

use std::collections::HashMap;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Git status for one project folder — the frontend `GitStatus` contract. Every
/// field is `Option` (null when git couldn't answer) so the shape is stable.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub dirty: Option<bool>,
    /// Number of changed paths in the worktree (porcelain line count), or `null`
    /// when git couldn't answer. `dirty` is just `modified > 0`.
    pub modified: Option<i64>,
    pub ahead: Option<i64>,
    pub behind: Option<i64>,
}

/// Run `git -C <dir> <args...>`, returning trimmed stdout on a clean exit, else
/// `None` (non-zero exit, spawn error, or non-UTF8 output). Fully guarded.
fn run_git(dir: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    Some(text.trim().to_string())
}

/// Compute the git status for a single folder. Mirrors the statusline wrapper:
/// each field is left null when its git query fails.
pub fn status_for_dir(dir: &str) -> GitStatus {
    let mut out = GitStatus::default();
    if dir.is_empty() {
        return out;
    }

    if let Some(branch) = run_git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        out.branch = if branch.is_empty() { None } else { Some(branch) };
    }
    // `--porcelain` prints one line per change; empty stdout => clean tree. The
    // line count is the number of modified paths (`dirty` is just `count > 0`).
    if let Some(porcelain) = run_git(dir, &["status", "--porcelain"]) {
        let count = if porcelain.is_empty() {
            0
        } else {
            porcelain.lines().count() as i64
        };
        out.dirty = Some(count > 0);
        out.modified = Some(count);
    }
    // Commits BEHIND origin/main (matches the footer / user's Claude statusline).
    if let Some(behind) = run_git(dir, &["rev-list", "HEAD..origin/main", "--count", "--no-merges"])
    {
        if let Ok(n) = behind.parse::<i64>() {
            out.behind = Some(n);
        }
    }
    // Commits AHEAD of the upstream tracking branch (not yet pushed).
    if let Some(ahead) = run_git(dir, &["rev-list", "@{upstream}..HEAD", "--count"]) {
        if let Ok(n) = ahead.parse::<i64>() {
            out.ahead = Some(n);
        }
    }
    out
}

/// Compute git status for every `path` in parallel, keyed by the path verbatim
/// (so the frontend resolves each project's row directly). A blank/duplicate path
/// still maps to a stable (all-null) entry. Never fails: a probe that errors out
/// yields an all-null status.
pub fn status_for_paths(paths: &[String]) -> HashMap<String, GitStatus> {
    let handles: Vec<_> = paths
        .iter()
        .cloned()
        .map(|path| thread::spawn(move || (path.clone(), status_for_dir(&path))))
        .collect();

    let mut map = HashMap::new();
    for handle in handles {
        if let Ok((path, status)) = handle.join() {
            map.insert(path, status);
        }
    }
    map
}

// ───────────────────────── push / pull ─────────────────────────
//
// User-initiated sync actions for a project, fired from the project row's
// context menu. Unlike the silent `run_git` status probes, these surface git's
// own message on BOTH success and failure (a push/pull is an explicit action the
// user wants feedback on), so the frontend can show it in a toast.

/// Run `git -C <dir> <args...>` as a user-initiated action, returning git's own
/// message either way: `Ok(message)` on a clean exit, `Err(message)` otherwise.
/// Push/pull write their progress to stderr, so the message prefers stderr when
/// stdout is empty (and vice-versa on failure). Never panics.
///
/// Runs git NON-INTERACTIVELY so a network sync can never hang the async command
/// waiting on a prompt: `GIT_TERMINAL_PROMPT=0` makes git's own credential prompt
/// fail fast, and a `BatchMode=yes` ssh (with a bounded connect timeout) makes ssh
/// refuse rather than block on a passphrase / unknown-host-key prompt. Both turn
/// an otherwise-infinite wait into a clean `Err` the frontend can toast.
fn run_git_action(dir: &str, args: &[&str]) -> Result<String, String> {
    if dir.is_empty() {
        return Err("no project folder".to_string());
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=10")
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    // git push/pull report status on stderr; pick whichever stream spoke.
    let message = |primary: String, fallback: String| {
        if !primary.is_empty() {
            primary
        } else {
            fallback
        }
    };
    if output.status.success() {
        Ok(message(stderr, stdout))
    } else {
        let msg = message(stderr, stdout);
        Err(if msg.is_empty() {
            "git command failed".to_string()
        } else {
            msg
        })
    }
}

/// Push the project's current branch to its remote (`git push`). Returns git's
/// message on success, an error message (no upstream / rejected / offline) on
/// failure.
pub fn push(dir: &str) -> Result<String, String> {
    run_git_action(dir, &["push"])
}

/// Pull the project's current branch from its remote, fast-forward ONLY
/// (`git pull --ff-only`). A clean fast-forward succeeds; a divergent branch
/// fails cleanly WITHOUT starting a merge, so a user-triggered Pull can never
/// leave the project's worktree in a half-merged, conflict-marked state. Returns
/// git's message on success, an error message (diverged / no upstream / offline)
/// on failure.
pub fn pull(dir: &str) -> Result<String, String> {
    run_git_action(dir, &["pull", "--ff-only"])
}

// ───────────────────────── git worktrees ─────────────────────────
//
// Auto-worktree projects launch each agent session into an isolated git
// worktree under `<repo>/.worktrees/<branch>`, branched off HEAD, so concurrent
// sessions never clobber one another's working tree. A session's worktree is
// pruned on close when it left nothing behind (clean tree, no commits past the
// base it forked from); otherwise it's kept for the user to reconcile. The
// management UI can list and explicitly prune accumulated worktrees.

/// Result of creating a fresh session worktree. JS sees `path/branch/base`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreated {
    /// Absolute path of the new worktree (`<repo>/.worktrees/<branch>`).
    pub path: String,
    /// The fresh `session/<ts>-<id>` branch the worktree is checked out on.
    pub branch: String,
    /// The base commit SHA (HEAD at creation) the branch forked from.
    pub base: String,
}

/// Outcome of a clean-only worktree removal. JS sees `removed/reason`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoval {
    /// True when the worktree (and its branch) were removed.
    pub removed: bool,
    /// Short why-kept reason when `removed` is false (`"dirty"` / `"has commits"`).
    pub reason: Option<String>,
}

/// One accumulated session worktree, for the management UI. JS sees
/// `path/branch/clean`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub clean: bool,
}

/// Process-local counter, mixed into the branch name so rapid successive calls
/// within the same second/nanosecond tick still get distinct branches.
static WORKTREE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Generate a unique `session/<unix-seconds>-<seq><nanos-suffix>` branch name.
fn unique_branch_name() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let seq = WORKTREE_SEQ.fetch_add(1, Ordering::Relaxed);
    // seq guarantees process-local uniqueness; nanos disambiguates across runs.
    format!("session/{}-{}{:09}", now.as_secs(), seq, now.subsec_nanos())
}

/// Ensure the repo-root `.gitignore` ignores `.worktrees`. Idempotent: appends a
/// `.worktrees` line only if no line exactly equal to `.worktrees` (or
/// `.worktrees/`) already exists; creates the file if missing.
fn ensure_worktrees_ignored(repo_path: &str) -> Result<(), String> {
    let gitignore = std::path::Path::new(repo_path).join(".gitignore");
    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
    let already = existing
        .lines()
        .any(|l| matches!(l.trim(), ".worktrees" | ".worktrees/"));
    if already {
        return Ok(());
    }
    // Preserve existing content; ensure we start on a fresh line.
    let mut body = existing;
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str(".worktrees\n");
    std::fs::write(&gitignore, body).map_err(|e| format!("writing .gitignore failed: {e}"))
}

/// Create a fresh session worktree off `repo_path`'s HEAD. Returns the worktree
/// path, the new branch, and the base SHA. `Err` on any failure (not a repo, git
/// error) — never panics.
pub fn worktree_create(repo_path: &str) -> Result<WorktreeCreated, String> {
    // Base SHA = HEAD. Also validates that this is a git repo with a commit.
    let base = run_git(repo_path, &["rev-parse", "HEAD"])
        .ok_or_else(|| format!("{repo_path} is not a git repo (or has no commits)"))?;

    ensure_worktrees_ignored(repo_path)?;

    let branch = unique_branch_name();
    let wt_path = std::path::Path::new(repo_path)
        .join(".worktrees")
        .join(&branch);
    let wt_str = wt_path.to_str().ok_or("worktree path is not valid UTF-8")?;

    run_git(
        repo_path,
        &["worktree", "add", "-b", &branch, wt_str, "HEAD"],
    )
    .ok_or_else(|| format!("git worktree add failed for {wt_str}"))?;

    // Return the CANONICAL path (matching what `git worktree list` reports), so
    // callers can compare/round-trip it against the listing without symlink skew.
    let path = std::fs::canonicalize(&wt_path)
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .unwrap_or_else(|| wt_str.to_string());

    Ok(WorktreeCreated { path, branch, base })
}

/// Remove a session worktree only if it's "clean": its `status --porcelain` is
/// empty AND it has zero commits past `base`. When clean, the worktree is removed
/// and its branch deleted (`removed=true`). When not clean, it's left intact
/// (`removed=false`, with a short reason). Only `Err`s on unexpected git failures.
pub fn worktree_remove_if_clean(worktree_path: &str, base: &str) -> Result<WorktreeRemoval, String> {
    // Resolve the branch and owning repo BEFORE removing, so we can delete the
    // branch from the main repo afterwards (the worktree dir is gone by then).
    let branch = run_git(worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok_or_else(|| format!("{worktree_path} is not a git worktree"))?;
    let main_repo = main_repo_dir(worktree_path);

    let porcelain = run_git(worktree_path, &["status", "--porcelain"])
        .ok_or_else(|| format!("git status failed in {worktree_path}"))?;
    if !porcelain.is_empty() {
        return Ok(WorktreeRemoval {
            removed: false,
            reason: Some("dirty".to_string()),
        });
    }

    let count = run_git(
        worktree_path,
        &["rev-list", &format!("{base}..HEAD"), "--count"],
    )
    .ok_or_else(|| format!("git rev-list failed in {worktree_path}"))?;
    if count.trim() != "0" {
        return Ok(WorktreeRemoval {
            removed: false,
            reason: Some("has commits".to_string()),
        });
    }

    // Clean: prune the worktree, then delete the now-unused branch from the main
    // repo (the worktree dir no longer exists after removal).
    remove_worktree(worktree_path, false)?;
    if let Some(repo) = main_repo.as_deref() {
        delete_branch(repo, &branch);
    }
    Ok(WorktreeRemoval {
        removed: true,
        reason: None,
    })
}

/// Resolve the MAIN repository working dir that owns `worktree_path`, so a branch
/// delete can run there AFTER the worktree dir is gone. Uses
/// `git rev-parse --path-format=absolute --git-common-dir`, whose parent is the
/// main worktree root. Falls back to `<repo>/.worktrees` parent inference when git
/// can't answer. `None` only if neither works.
fn main_repo_dir(worktree_path: &str) -> Option<String> {
    if let Some(common) = run_git(
        worktree_path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    ) {
        // `--git-common-dir` points at the main repo's `.git`; its parent is the
        // main worktree root.
        let p = std::path::Path::new(common.trim());
        if let Some(parent) = p.parent() {
            return parent.to_str().map(|s| s.to_string());
        }
    }
    // Fallback: <repo>/.worktrees/<branch...> → climb to the dir holding
    // `.worktrees`.
    let path = std::path::Path::new(worktree_path);
    for anc in path.ancestors() {
        if anc.file_name().and_then(|n| n.to_str()) == Some(".worktrees") {
            return anc.parent().and_then(|p| p.to_str()).map(|s| s.to_string());
        }
    }
    None
}

/// List the session worktrees under `<repo>/.worktrees/`, with each one's branch
/// and clean flag. Off-repo / git failure yields an empty list.
pub fn worktree_list(repo_path: &str) -> Vec<WorktreeInfo> {
    let Some(porcelain) = run_git(repo_path, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let raw_prefix = std::path::Path::new(repo_path).join(".worktrees");
    // Git reports CANONICALIZED paths (e.g. /private/var on macOS) while the repo
    // path the caller passed may be symlinked (/var). Canonicalize the prefix so
    // the `starts_with` filter matches regardless; fall back to the raw prefix.
    let prefix = std::fs::canonicalize(&raw_prefix).unwrap_or(raw_prefix);

    let mut out = Vec::new();
    let mut cur_path: Option<String> = None;
    let mut cur_branch: Option<String> = None;

    // The porcelain output is record-per-worktree, blank-line separated; a record
    // starts with `worktree <abs-path>` and may carry a `branch refs/heads/<name>`.
    let flush = |path: &mut Option<String>, branch: &mut Option<String>, out: &mut Vec<WorktreeInfo>| {
        if let Some(p) = path.take() {
            if std::path::Path::new(&p).starts_with(&prefix) {
                let clean = run_git(&p, &["status", "--porcelain"])
                    .map(|s| s.is_empty())
                    .unwrap_or(false);
                out.push(WorktreeInfo {
                    path: p,
                    branch: branch.clone(),
                    clean,
                });
            }
        }
        *branch = None;
    };

    for line in porcelain.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            // New record begins — flush the previous one.
            flush(&mut cur_path, &mut cur_branch, &mut out);
            cur_path = Some(p.trim().to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            cur_branch = Some(b.trim().trim_start_matches("refs/heads/").to_string());
        }
    }
    flush(&mut cur_path, &mut cur_branch, &mut out);
    out
}

/// Explicitly remove a worktree (management UI prune). `force` passes `--force`
/// to git (drops uncommitted changes). The worktree's branch is also deleted.
pub fn worktree_remove(worktree_path: &str, force: bool) -> Result<(), String> {
    // Resolve the branch and owning repo before removal so we can delete the
    // branch from the main repo afterwards (the worktree dir is gone by then).
    let main_repo = main_repo_dir(worktree_path);
    // Prefer a direct query; if the worktree dir was already deleted out-of-band,
    // `git -C <gone>` fails, so fall back to the main repo's worktree listing.
    let branch = run_git(worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]).or_else(|| {
        main_repo
            .as_deref()
            .and_then(|repo| branch_for_worktree(repo, worktree_path))
    });
    remove_worktree(worktree_path, force)?;
    if let (Some(b), Some(repo)) = (branch, main_repo.as_deref()) {
        delete_branch(repo, &b);
    }
    Ok(())
}

/// Run `git worktree remove [--force] <path>`. Spawns from the worktree itself so
/// git resolves the owning repo; the explicit path arg keeps the target
/// unambiguous. `Err` on git failure.
fn remove_worktree(worktree_path: &str, force: bool) -> Result<(), String> {
    // Run from the MAIN repo, not the worktree itself: a `git -C <worktree>` call
    // fails outright once the worktree dir is gone (removed underneath us), which
    // would make the prune fallback below unreachable. `main_repo_dir` has a
    // pure-path fallback, so it resolves even for an already-missing worktree dir.
    let main = main_repo_dir(worktree_path);
    let run_dir = main.as_deref().unwrap_or(worktree_path);

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    // Try a clean removal; if it fails, prune stale admin entries (covers a worktree
    // dir deleted out-of-band). Both run from the main repo.
    let _ = run_git(run_dir, &args).or_else(|| run_git(run_dir, &["worktree", "prune"]));

    // Only report success when the worktree is ACTUALLY gone. `git worktree prune`
    // exits 0 without removing a still-present-but-unremovable worktree, so trusting
    // its exit code would falsely claim removal — and the caller would then delete
    // the branch out from under a worktree still on disk.
    if std::path::Path::new(worktree_path).exists() {
        return Err(format!("git worktree remove failed for {worktree_path}"));
    }
    Ok(())
}

/// Resolve a worktree's branch from the MAIN repo's listing. Works even when the
/// worktree dir is already gone (git keeps the admin entry until pruned), so it
/// backstops a direct `rev-parse` that can't run against a missing dir.
fn branch_for_worktree(main_repo: &str, worktree_path: &str) -> Option<String> {
    let target = std::fs::canonicalize(worktree_path)
        .ok()
        .and_then(|p| p.to_str().map(str::to_string));
    worktree_list(main_repo)
        .into_iter()
        .find(|w| w.path == worktree_path || target.as_deref() == Some(w.path.as_str()))
        .and_then(|w| w.branch)
}

/// Best-effort delete of a now-unused branch. `dir` MUST be the main repo dir
/// (callers resolve it via `main_repo_dir` BEFORE removal, since the worktree dir
/// is gone by the time this runs). Failure is swallowed: a leftover branch is
/// harmless and must not fail close.
fn delete_branch(dir: &str, branch: &str) {
    let _ = run_git(dir, &["branch", "-D", branch]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// A throwaway temp dir, removed on drop.
    struct TempRepo(PathBuf);
    impl TempRepo {
        /// `git init` a fresh repo under the system temp dir with an identity and
        /// one initial commit, so HEAD resolves.
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-git-{tag}-{nanos}"));
            fs::create_dir_all(&dir).unwrap();
            let path = dir.to_str().unwrap();
            run(path, &["init", "-q"]);
            run(path, &["config", "user.email", "t@example.com"]);
            run(path, &["config", "user.name", "Test"]);
            // Keep default branch deterministic across git versions.
            run(path, &["checkout", "-q", "-b", "main"]);
            fs::write(dir.join("README.md"), "hello\n").unwrap();
            run(path, &["add", "."]);
            run(path, &["commit", "-q", "-m", "init"]);
            TempRepo(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn str(&self) -> &str {
            self.0.to_str().unwrap()
        }
    }
    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Run a git command in `dir`, asserting success (test setup helper).
    fn run(dir: &str, args: &[&str]) {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn launching_an_auto_worktree_project() {
        let repo = TempRepo::new("create");
        let info = worktree_create(repo.str()).expect("create should succeed");
        // Path is under <repo>/.worktrees/ (canonicalize to absorb macOS's
        // /var -> /private/var symlink, since the returned path is canonical).
        let wt_dir = fs::canonicalize(repo.path()).unwrap().join(".worktrees");
        assert!(
            Path::new(&info.path).starts_with(&wt_dir),
            "{} should be under {:?}",
            info.path,
            wt_dir
        );
        // Branch is a fresh session/... branch.
        assert!(info.branch.starts_with("session/"), "branch was {}", info.branch);
        // Base SHA is a 40-char-ish hex commit.
        assert!(info.base.len() >= 7 && info.base.chars().all(|c| c.is_ascii_hexdigit()));
        // The worktree directory exists on disk.
        assert!(Path::new(&info.path).is_dir(), "worktree dir should exist");
    }

    #[test]
    fn worktree_create_errors_on_non_git_dir() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("agentdesk-git-nonrepo-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        let res = worktree_create(dir.to_str().unwrap());
        let _ = fs::remove_dir_all(&dir);
        assert!(res.is_err(), "non-git dir should Err, got {:?}", res);
    }

    #[test]
    fn first_worktree_updates_gitignore() {
        let repo = TempRepo::new("gitignore");
        worktree_create(repo.str()).unwrap();
        let gi = repo.path().join(".gitignore");
        let body = fs::read_to_string(&gi).expect(".gitignore should exist");
        let count = body.lines().filter(|l| l.trim() == ".worktrees").count();
        assert_eq!(count, 1, ".worktrees should appear exactly once: {:?}", body);
        // A second create must NOT duplicate the ignore line.
        worktree_create(repo.str()).unwrap();
        let body2 = fs::read_to_string(&gi).unwrap();
        let count2 = body2.lines().filter(|l| l.trim() == ".worktrees").count();
        assert_eq!(count2, 1, "second create should not duplicate: {:?}", body2);
    }

    #[test]
    fn concurrent_launches_get_distinct_worktrees() {
        let repo = TempRepo::new("distinct");
        let a = worktree_create(repo.str()).unwrap();
        let b = worktree_create(repo.str()).unwrap();
        assert_ne!(a.branch, b.branch, "branches must differ");
        assert_ne!(a.path, b.path, "paths must differ");
    }

    #[test]
    fn clean_worktree_is_removed_on_close() {
        let repo = TempRepo::new("clean");
        let info = worktree_create(repo.str()).unwrap();
        let res = worktree_remove_if_clean(&info.path, &info.base).unwrap();
        assert!(res.removed, "clean worktree should be removed: {:?}", res);
        assert!(!Path::new(&info.path).is_dir(), "worktree dir should be gone");
    }

    #[test]
    fn dirty_worktree_is_kept_on_close() {
        let repo = TempRepo::new("dirty");
        let info = worktree_create(repo.str()).unwrap();
        // Make the worktree dirty with an uncommitted file.
        fs::write(Path::new(&info.path).join("scratch.txt"), "wip\n").unwrap();
        let res = worktree_remove_if_clean(&info.path, &info.base).unwrap();
        assert!(!res.removed, "dirty worktree should be kept: {:?}", res);
        assert!(Path::new(&info.path).is_dir(), "worktree dir should remain");
    }

    #[test]
    fn listing_accumulated_worktrees() {
        let repo = TempRepo::new("list");
        let info = worktree_create(repo.str()).unwrap();
        let list = worktree_list(repo.str());
        let found = list
            .iter()
            .find(|w| w.path == info.path)
            .expect("created worktree should be listed");
        assert_eq!(found.branch.as_deref(), Some(info.branch.as_str()));
        assert!(found.clean, "fresh worktree should be clean");
    }

    #[test]
    fn pruning_a_worktree() {
        let repo = TempRepo::new("prune");
        let info = worktree_create(repo.str()).unwrap();
        // Dirty it so a non-force remove would refuse; force should still prune.
        fs::write(Path::new(&info.path).join("scratch.txt"), "wip\n").unwrap();
        worktree_remove(&info.path, true).expect("force remove should succeed");
        assert!(!Path::new(&info.path).is_dir(), "worktree dir should be gone");
    }

    #[test]
    fn pruning_a_worktree_whose_dir_was_deleted_out_of_band() {
        // Regression: prune must run from the MAIN repo, not the (now-missing)
        // worktree dir, and the branch must still be deleted afterwards.
        let repo = TempRepo::new("prune-gone");
        let info = worktree_create(repo.str()).unwrap();
        // Simulate the user deleting the worktree folder directly.
        fs::remove_dir_all(&info.path).unwrap();
        assert!(!Path::new(&info.path).is_dir());

        worktree_remove(&info.path, false).expect("remove of an already-gone dir should succeed");

        // Admin metadata pruned: the worktree no longer appears in the listing...
        let listed = worktree_list(repo.str());
        assert!(
            !listed.iter().any(|w| w.path == info.path),
            "stale worktree should be pruned from the listing"
        );
        // ...and its branch is gone (deleted from the main repo).
        let branches = run_git(repo.str(), &["branch", "--list", &info.branch]).unwrap_or_default();
        assert!(branches.trim().is_empty(), "session branch should be deleted");
    }

    /// `git init --bare` a throwaway remote under the temp dir. Returns its path
    /// holder (removed on drop) — a stand-in `origin` for push/pull tests.
    fn bare_remote(tag: &str) -> TempRepo {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("agentdesk-bare-{tag}-{nanos}.git"));
        fs::create_dir_all(&dir).unwrap();
        run(dir.to_str().unwrap(), &["init", "--bare", "-q"]);
        TempRepo(dir)
    }

    #[test]
    fn push_sends_commits_to_a_configured_remote() {
        let repo = TempRepo::new("push");
        let remote = bare_remote("push");
        run(repo.str(), &["remote", "add", "origin", remote.str()]);
        run(repo.str(), &["push", "-u", "origin", "main"]);
        // A new local commit not yet on the remote.
        fs::write(repo.path().join("more.md"), "more\n").unwrap();
        run(repo.str(), &["add", "."]);
        run(repo.str(), &["commit", "-q", "-m", "more"]);

        push(repo.str()).expect("push to a configured remote should succeed");

        // The remote now has 2 commits on main.
        let count = run_git(remote.str(), &["rev-list", "main", "--count"]).unwrap();
        assert_eq!(count, "2", "remote should have received the pushed commit");
    }

    #[test]
    fn push_without_a_remote_errors() {
        let repo = TempRepo::new("pushnorem");
        let res = push(repo.str());
        assert!(res.is_err(), "push with no remote should Err, got {:?}", res);
    }

    #[test]
    fn pull_on_a_divergent_branch_fails_without_a_mid_merge_worktree() {
        // A clone and its origin each commit a DIFFERENT file on main → the
        // branches diverge. A plain `git pull` would try to merge (and could leave
        // a conflicted, mid-merge worktree); `--ff-only` must instead refuse
        // cleanly, leaving the clone's worktree untouched (no MERGE_HEAD).
        let origin = TempRepo::new("divorigin");
        let remote = bare_remote("div");
        run(origin.str(), &["remote", "add", "origin", remote.str()]);
        run(origin.str(), &["push", "-u", "origin", "main"]);

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let clone_dir = std::env::temp_dir().join(format!("agentdesk-divclone-{nanos}"));
        run(
            std::env::temp_dir().to_str().unwrap(),
            &["clone", "-q", remote.str(), clone_dir.to_str().unwrap()],
        );
        run(clone_dir.to_str().unwrap(), &["config", "user.email", "t@example.com"]);
        run(clone_dir.to_str().unwrap(), &["config", "user.name", "Test"]);
        let clone = TempRepo(clone_dir);

        // Origin advances main and pushes.
        fs::write(origin.path().join("o.md"), "origin\n").unwrap();
        run(origin.str(), &["add", "."]);
        run(origin.str(), &["commit", "-q", "-m", "origin-side"]);
        run(origin.str(), &["push", "origin", "main"]);

        // The clone makes its OWN divergent commit (not on the remote).
        fs::write(clone.path().join("c.md"), "clone\n").unwrap();
        run(clone.str(), &["add", "."]);
        run(clone.str(), &["commit", "-q", "-m", "clone-side"]);

        let res = pull(clone.str());
        assert!(res.is_err(), "divergent ff-only pull should fail, got {:?}", res);
        // The worktree must NOT be left mid-merge.
        assert!(
            !clone.path().join(".git").join("MERGE_HEAD").exists(),
            "ff-only pull must not start a merge"
        );
    }

    #[test]
    fn pull_fast_forwards_from_the_remote() {
        // A bare remote seeded from one clone; a second clone pulls the new commit.
        let origin = TempRepo::new("pullorigin");
        let remote = bare_remote("pull");
        run(origin.str(), &["remote", "add", "origin", remote.str()]);
        run(origin.str(), &["push", "-u", "origin", "main"]);

        // Clone the remote into a fresh working dir.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let clone_dir = std::env::temp_dir().join(format!("agentdesk-clone-{nanos}"));
        run(
            std::env::temp_dir().to_str().unwrap(),
            &["clone", "-q", remote.str(), clone_dir.to_str().unwrap()],
        );
        let clone = TempRepo(clone_dir);

        // Origin commits + pushes a new file; the clone should pull it.
        fs::write(origin.path().join("fresh.md"), "fresh\n").unwrap();
        run(origin.str(), &["add", "."]);
        run(origin.str(), &["commit", "-q", "-m", "fresh"]);
        run(origin.str(), &["push", "origin", "main"]);

        pull(clone.str()).expect("pull from the remote should succeed");

        assert!(
            clone.path().join("fresh.md").exists(),
            "pull should have brought the new file into the clone"
        );
    }

    #[test]
    fn blank_or_off_repo_dir_is_all_null() {
        assert_eq!(status_for_dir(""), GitStatus::default());
        let off_repo = status_for_dir("/definitely/not/a/repo/anywhere");
        assert_eq!(off_repo, GitStatus::default());
    }

    #[test]
    fn inside_a_repo_reports_a_branch_and_clean_flag() {
        // The crate itself lives in a git checkout, so its manifest dir is a repo.
        let dir = env!("CARGO_MANIFEST_DIR");
        let status = status_for_dir(dir);
        assert!(status.branch.is_some(), "expected a branch inside the repo");
        // `dirty` resolves to a concrete bool (clean or not), never null, in a repo.
        assert!(status.dirty.is_some(), "expected a dirty flag inside the repo");
        // `modified` resolves to a concrete count (>= 0) inside a repo.
        assert!(status.modified.is_some(), "expected a modified count inside the repo");
        assert!(status.modified.unwrap() >= 0);
    }

    #[test]
    fn status_for_paths_keys_by_path_and_covers_every_input() {
        let dir = env!("CARGO_MANIFEST_DIR").to_string();
        let paths = vec![dir.clone(), "/definitely/not/a/repo".to_string()];
        let map = status_for_paths(&paths);
        assert_eq!(map.len(), 2);
        assert!(map[&dir].branch.is_some());
        assert_eq!(map["/definitely/not/a/repo"], GitStatus::default());
    }
}
