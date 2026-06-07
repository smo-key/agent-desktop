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
use std::thread;

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

#[cfg(test)]
mod tests {
    use super::*;

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
