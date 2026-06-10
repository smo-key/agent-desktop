//! Pull-request status lookup for the footer PR button.
//!
//! The footer shows a PR button next to the edited-files pill. To decide whether
//! clicking should OPEN an existing PR or open a CREATE-confirm dialog, the
//! frontend asks here: does an OPEN PR from the repo's current branch into `base`
//! already exist? We answer by shelling out to the GitHub CLI:
//!
//! ```text
//! gh pr list --head <branch> --base <base> --state open --json url,number
//! ```
//!
//! Like [`crate::claude_title`], this is split into a PURE, unit-tested argument +
//! output PARSER and a thin async runner. The runner spawns the real `gh` binary,
//! so it only fully RUNS in an authenticated environment (MANUAL); it COMPILES
//! regardless and the arg + parse shapes are exercised headlessly here.
//!
//! Every failure is BEST-EFFORT and degrades to [`PrStatus::Unknown`] — NOT an
//! error. `gh` missing, unauthenticated, offline, or emitting malformed JSON all
//! collapse to `Unknown`, and the spec says the button then falls back to the
//! create-confirm path (never "do nothing"). So `pr_status_for` returns
//! `Ok(PrStatus)` in every case the frontend cares about; the only `Err` is the
//! degenerate "no repo path", which the frontend also treats as unknown.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

/// Hard timeout for the `gh pr list` call so a hung CLI (e.g. a wedged network
/// auth refresh) can never block the PR-status refresh; on timeout the runner
/// degrades to [`PrStatus::Unknown`].
const GH_TIMEOUT: Duration = Duration::from_secs(15);

/// The result of a PR-status lookup for the current branch → base.
///
/// `Exists` carries the PR's web URL + number so the frontend can open it.
/// `None` means we got a clean answer and there is no open PR. `Unknown` means we
/// could NOT determine existence (gh missing / unauthenticated / errored / bad
/// output) — the frontend falls back to the create-confirm path, NOT to nothing.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PrStatus {
    /// An open PR from the current branch into the base exists.
    Exists { url: String, number: i64 },
    /// No open PR exists (clean answer from `gh`).
    None,
    /// PR existence could not be determined; treat as "no PR" for the create path.
    Unknown,
}

// --- Pure helpers: argument builder + output parser -------------------------

/// PURE: build the `gh` argument vector for listing the OPEN PR from `branch`
/// into `base` as JSON. `--head`/`--base` scope the query to exactly this
/// branch→base pair; `--state open` ignores merged/closed PRs; `--json
/// url,number` makes the output structured (an array we parse below).
///
/// `branch` and `base` are passed as the VALUES of `--head`/`--base`, so a name
/// beginning with `-` is consumed as that flag's argument and never parsed as a
/// flag itself.
pub fn gh_pr_list_args(branch: &str, base: &str) -> Vec<String> {
    vec![
        "pr".to_string(),
        "list".to_string(),
        "--head".to_string(),
        branch.to_string(),
        "--base".to_string(),
        base.to_string(),
        "--state".to_string(),
        "open".to_string(),
        "--json".to_string(),
        "url,number".to_string(),
    ]
}

/// PURE: parse `gh pr list --json url,number` stdout into a [`PrStatus`].
///
/// `gh` prints a JSON ARRAY of objects; an empty array `[]` means no matching PR.
/// We take the FIRST entry (the query is already scoped to one branch→base/open,
/// so at most one PR is expected) and read its `url` (string) + `number`
/// (integer). On a clean-but-empty array → [`PrStatus::None`]. On ANYTHING we
/// can't make sense of (not an array, an entry missing url/number, non-JSON) →
/// [`PrStatus::Unknown`] — we'd rather fall back to the create-confirm path than
/// claim a wrong answer.
pub fn parse_pr_list(stdout: &str) -> PrStatus {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return PrStatus::Unknown;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return PrStatus::Unknown,
    };
    let arr = match value.as_array() {
        Some(a) => a,
        None => return PrStatus::Unknown,
    };
    let first = match arr.first() {
        // A clean, empty array is an authoritative "no open PR".
        None => return PrStatus::None,
        Some(f) => f,
    };
    let url = first.get("url").and_then(|u| u.as_str());
    let number = first.get("number").and_then(|n| n.as_i64());
    match (url, number) {
        (Some(url), Some(number)) if !url.is_empty() => PrStatus::Exists {
            url: url.to_string(),
            number,
        },
        // A present-but-malformed entry: don't guess — fall back to Unknown.
        _ => PrStatus::Unknown,
    }
}

// --- Environment seeding ----------------------------------------------------

/// Seed a minimal environment for the `gh` child so it is discoverable from a
/// sparse GUI process: inherit `PATH`/`HOME` when present, else fall back to a
/// sane `PATH` default. Mirrors [`crate::claude_title`]'s `seed_claude_env` — the
/// same fallback that lets a child find a Homebrew-installed binary when the app
/// was launched from Finder with a stripped environment. `HOME` is forwarded so
/// `gh` can read its auth/config under `~`.
fn seed_gh_env(cmd: &mut tokio::process::Command) {
    let path = std::env::var("PATH")
        .unwrap_or_else(|_| "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin".to_string());
    cmd.env("PATH", path);
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
}

// --- Async runner -----------------------------------------------------------

/// Look up the OPEN PR status for `repo_path`'s current branch into `base`.
///
/// Resolves the current branch with `git rev-parse --abbrev-ref HEAD` in
/// `repo_path`, then runs `gh pr list --head <branch> --base <base> --state open
/// --json url,number` (with `repo_path` as the working dir so `gh` targets the
/// right repo) and parses the output.
///
/// BEST-EFFORT, NEVER fails for the frontend's decision: a missing/empty branch,
/// `branch == base` (a base branch has no self-PR), a missing/unauthenticated
/// `gh`, a non-zero exit, a timeout, or malformed output ALL resolve to
/// [`PrStatus::Unknown`] (the create-confirm fallback). Returns `Ok` in every
/// such case; the runner only logs at the seams.
pub async fn pr_status_for(repo_path: &str, base: &str) -> PrStatus {
    let branch = match current_branch(repo_path).await {
        Some(b) if !b.is_empty() && b != "HEAD" => b,
        // No branch / detached HEAD / git failed → can't query → Unknown.
        _ => return PrStatus::Unknown,
    };
    // A base branch has no PR INTO itself; don't even ask gh.
    if branch == base {
        return PrStatus::Unknown;
    }

    let args = gh_pr_list_args(&branch, base);
    let mut cmd = tokio::process::Command::new("gh");
    cmd.args(&args)
        .current_dir(repo_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // KILL the child if its handle is dropped (timeout branch) so a hung `gh`
        // can't leak across the footer's repeated PR-status polls. Mirrors
        // `claude_title`'s rationale.
        .kill_on_drop(true);
    seed_gh_env(&mut cmd);

    let child = match cmd.spawn() {
        Ok(c) => c,
        // `gh` not installed / not on PATH → Unknown (create-confirm fallback).
        Err(_) => return PrStatus::Unknown,
    };

    let output = match tokio::time::timeout(GH_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        // Timed out, or awaiting the child failed → Unknown.
        _ => return PrStatus::Unknown,
    };
    if !output.status.success() {
        // Unauthenticated / offline / repo not on GitHub → non-zero exit → Unknown.
        return PrStatus::Unknown;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_pr_list(&stdout)
}

/// Resolve the current branch name in `dir` via `git rev-parse --abbrev-ref
/// HEAD`. Returns `None` when git can't answer (off-repo / spawn error /
/// non-zero exit / non-UTF8). A detached HEAD yields `Some("HEAD")`, which the
/// caller treats as "no branch".
async fn current_branch(dir: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gh_pr_list_args_scope_head_base_state_and_json() {
        let args = gh_pr_list_args("feature-x", "main");
        assert_eq!(
            args,
            vec![
                "pr",
                "list",
                "--head",
                "feature-x",
                "--base",
                "main",
                "--state",
                "open",
                "--json",
                "url,number",
            ]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn gh_pr_list_args_thread_branch_and_base_as_flag_values() {
        // A branch name starting with `-` is the VALUE of `--head` (argv position
        // after the flag), so it can't be reparsed as a flag.
        let args = gh_pr_list_args("--oops", "main");
        let i = args.iter().position(|a| a == "--head").expect("--head present");
        assert_eq!(args[i + 1], "--oops");
    }

    #[test]
    fn parse_pr_list_exists_for_a_single_open_pr() {
        let out = r#"[{"number":42,"url":"https://github.com/o/r/pull/42"}]"#;
        assert_eq!(
            parse_pr_list(out),
            PrStatus::Exists {
                url: "https://github.com/o/r/pull/42".to_string(),
                number: 42,
            }
        );
    }

    #[test]
    fn parse_pr_list_takes_the_first_when_several_are_returned() {
        // Defensive: the query is scoped to one branch→base/open, but if gh ever
        // returns >1 we take the first deterministically rather than erroring.
        let out = r#"[
            {"number":7,"url":"https://github.com/o/r/pull/7"},
            {"number":8,"url":"https://github.com/o/r/pull/8"}
        ]"#;
        assert_eq!(
            parse_pr_list(out),
            PrStatus::Exists {
                url: "https://github.com/o/r/pull/7".to_string(),
                number: 7,
            }
        );
    }

    #[test]
    fn parse_pr_list_none_for_an_empty_array() {
        // gh's authoritative "no matching PR" is an empty JSON array.
        assert_eq!(parse_pr_list("[]"), PrStatus::None);
        assert_eq!(parse_pr_list("  []  \n"), PrStatus::None);
    }

    #[test]
    fn parse_pr_list_unknown_for_empty_output() {
        // No output at all (e.g. gh wrote only to stderr) → can't tell → Unknown.
        assert_eq!(parse_pr_list(""), PrStatus::Unknown);
        assert_eq!(parse_pr_list("   \n  "), PrStatus::Unknown);
    }

    #[test]
    fn parse_pr_list_unknown_for_non_json() {
        // A gh error printed to stdout, or any non-JSON text → Unknown.
        assert_eq!(parse_pr_list("gh: not authenticated"), PrStatus::Unknown);
        assert_eq!(parse_pr_list("{not json"), PrStatus::Unknown);
    }

    #[test]
    fn parse_pr_list_unknown_for_non_array_json() {
        // Valid JSON but not the array gh promises (e.g. an error object) → Unknown.
        assert_eq!(parse_pr_list(r#"{"message":"Bad credentials"}"#), PrStatus::Unknown);
    }

    #[test]
    fn parse_pr_list_unknown_for_an_entry_missing_fields() {
        // A present-but-malformed entry (missing url or number, or empty url): we
        // don't guess a partial answer — fall back to Unknown (create-confirm path).
        assert_eq!(parse_pr_list(r#"[{"number":1}]"#), PrStatus::Unknown);
        assert_eq!(
            parse_pr_list(r#"[{"url":"https://github.com/o/r/pull/1"}]"#),
            PrStatus::Unknown
        );
        assert_eq!(parse_pr_list(r#"[{"url":"","number":1}]"#), PrStatus::Unknown);
    }
}
