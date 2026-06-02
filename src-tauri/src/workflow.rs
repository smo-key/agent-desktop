//! Workflow-board capability (Milestone 6, design D6) — STAGE 1: capability
//! DETECTION plus a generic, strictly READ-ONLY runner over a repo's own
//! `/workflow` skill scripts.
//!
//! A repo opts into the board by shipping the `/workflow` skill (the convention
//! from the skipa repo: `next.sh`, `epics.sh`, `issues.sh`, `jira.sh` under
//! `.claude/skills/workflow/`, optionally mirrored as slash commands under
//! `.claude/commands/workflow/`). The board is GENERIC: it never bundles its own
//! copy of those scripts — it runs whatever the target repo ships, with the child
//! process working directory set to the repo root, because each repo's scripts
//! carry repo-specific constants (`JIRA_PROJECT_KEY="SKIPA"`) and resolve auth via
//! `git rev-parse --show-toplevel` against that cwd
//! (`<repo>/.claude/settings.local.json`).
//!
//! Two output conventions, learned from the reference scripts:
//!
//!   1. `next.sh [epic]` prints formatted MARKDOWN to stdout. We return it
//!      verbatim — the frontend renders it as the board's "next" view.
//!
//!   2. `epics.sh list|get` and `issues.sh <type> list|get` use the `jira_output`
//!      helper: they write the JSON to a temp file under `$TMPDIR` and print a
//!      SINGLE LINE = that file's path. We read the named file, JSON-parse it,
//!      DELETE it (even on parse failure, so nothing leaks), and return the parsed
//!      value.
//!
//! READ-ONLY BY CONSTRUCTION. `issues.sh` exposes write verbs
//! (`create/update/transition/rank/delete`) in the same CLI dispatch, but this
//! module builds every argv from a hard, in-code ALLOWLIST ([`next.sh`], `list`,
//! `get`). There is no code path — public command or internal helper — that places
//! a write verb on a script's command line. The allowlist is the only thing that
//! turns a (verb, args) request into a spawn; an unknown verb is rejected before
//! any process starts. A unit test asserts the rejection
//! (`write_verbs_are_never_spawned`).
//!
//! Errors are STRUCTURED, never a silent empty board: a nonzero script exit
//! (missing `settings.local.json`, empty token, network/auth failure) returns the
//! captured stderr; a missing/​unparseable temp file returns an error rather than
//! panicking.
//!
//! Every load-bearing piece — detection, the allowlist, cwd, markdown passthrough,
//! temp-file parse + cleanup, and the error surface — is exercised by unit tests
//! named after the workflow-board spec scenarios, using fake bash scripts written
//! into a `tempdir` (NO real Jira / auth / network).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

// ---------------------------------------------------------------------------
// Detection.
// ---------------------------------------------------------------------------

/// Whether a repo is workflow-capable, and which of the two `/workflow` tooling
/// directories it ships. Serialized camelCase for the JS side. A repo is capable
/// iff at least one of `commands/workflow/` or `skills/workflow/` exists as a
/// directory under `<repo>/.claude/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    /// `true` iff `has_commands || has_skills`.
    pub capable: bool,
    /// `<repo>/.claude/commands/workflow/` exists as a directory.
    pub has_commands: bool,
    /// `<repo>/.claude/skills/workflow/` exists as a directory.
    pub has_skills: bool,
}

/// Classify `repo` as workflow-capable. Pure filesystem probe: it only stats the
/// two candidate directories and never spawns a script.
pub fn detect(repo: &Path) -> Capability {
    let has_commands = repo.join(".claude/commands/workflow").is_dir();
    let has_skills = repo.join(".claude/skills/workflow").is_dir();
    Capability {
        capable: has_commands || has_skills,
        has_commands,
        has_skills,
    }
}

// ---------------------------------------------------------------------------
// Read-only allowlist.
// ---------------------------------------------------------------------------

/// The read verb on a `<script> <verb> …` invocation. This is a CLOSED enum: the
/// only way to build an argv for `epics.sh`/`issues.sh` is to pick one of these,
/// so the write verbs (`create/update/transition/rank/delete`) are unreachable —
/// there is no variant for them and no code that emits them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadVerb {
    /// `<script> list [epic]` — the collection view.
    List,
    /// `<script> get <key>` — a single record.
    Get,
}

impl ReadVerb {
    /// The literal CLI token. Only ever `"list"` or `"get"`.
    fn as_str(self) -> &'static str {
        match self {
            ReadVerb::List => "list",
            ReadVerb::Get => "get",
        }
    }
}

/// The set of issue types `issues.sh` accepts (`feature|task|bug|request`). Also a
/// closed enum, so the type segment of an `issues.sh` argv is always one of these
/// four literals — never attacker/free-form text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueType {
    Feature,
    Task,
    Bug,
    Request,
}

impl IssueType {
    fn as_str(self) -> &'static str {
        match self {
            IssueType::Feature => "feature",
            IssueType::Task => "task",
            IssueType::Bug => "bug",
            IssueType::Request => "request",
        }
    }

    /// Parse the frontend's free-form `type` string into the closed enum,
    /// case-insensitively. An unknown type is rejected (no script runs) rather
    /// than passed through.
    pub fn parse(raw: &str) -> Result<Self, WorkflowError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "feature" => Ok(IssueType::Feature),
            "task" => Ok(IssueType::Task),
            "bug" => Ok(IssueType::Bug),
            "request" => Ok(IssueType::Request),
            other => Err(WorkflowError::unsupported(format!(
                "unsupported issue type {other:?} (allowed: feature, task, bug, request)"
            ))),
        }
    }
}

/// The scripts this module is allowed to run, by basename. There is intentionally
/// no general "run any script" entry point: a caller picks one of these typed
/// helpers, each of which appends only allowlisted verbs.
const NEXT_SCRIPT: &str = "next.sh";
const EPICS_SCRIPT: &str = "epics.sh";
const ISSUES_SCRIPT: &str = "issues.sh";

/// Reject a verb string that is anything other than a read verb. This is the
/// guard the public API uses to PROVE no write verb can ever reach a command
/// line: every write verb (`create/update/transition/rank/delete`) and any other
/// unknown token returns an error here, before a process is spawned.
///
/// The typed [`ReadVerb`] API means production code never calls this with a write
/// verb; it exists so the read-only guarantee is also enforced (and tested) at the
/// string boundary, mirroring the reference scripts' own verb vocabulary.
pub fn parse_read_verb(raw: &str) -> Result<ReadVerb, WorkflowError> {
    match raw.trim() {
        "list" => Ok(ReadVerb::List),
        "get" => Ok(ReadVerb::Get),
        // Named explicitly so the rejection of write verbs is unmistakable.
        "create" | "update" | "transition" | "rank" | "delete" => Err(WorkflowError::write_verb(
            format!("write verb {raw:?} is forbidden: the board is strictly read-only"),
        )),
        other => Err(WorkflowError::write_verb(format!(
            "unknown verb {other:?}: only read verbs (list, get) are permitted"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/// What went wrong running a workflow script. Serialized camelCase so the frontend
/// can show a per-repo error (with the captured stderr) instead of an empty board.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowError {
    /// Coarse kind, so the UI can distinguish "this repo isn't capable / bad
    /// request" from "the script failed (auth/network)".
    pub kind: WorkflowErrorKind,
    /// Human-readable summary (always present).
    pub message: String,
    /// The script's captured stderr, when a script ran and exited nonzero. This is
    /// what carries the actionable `ERROR: settings.local.json not found …` /
    /// `ERROR: JIRA_USER_EMAIL or JIRA_API_TOKEN not found …` lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    /// The script's exit code, when one ran and exited nonzero.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

/// Coarse classification of a [`WorkflowError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowErrorKind {
    /// The repo is not workflow-capable (no `/workflow` tooling dir).
    NotCapable,
    /// The expected script file does not exist in the repo.
    ScriptMissing,
    /// A write verb (or otherwise disallowed verb) was requested — rejected by the
    /// allowlist before any spawn.
    WriteVerbForbidden,
    /// The requested issue type / argument is not supported.
    Unsupported,
    /// The process could not be spawned at all (e.g. no shell).
    Spawn,
    /// The script ran but exited nonzero (auth/network/missing settings). Carries
    /// `stderr` + `exit_code`.
    ScriptFailed,
    /// The `jira_output` temp file was missing, empty, or not valid JSON.
    BadOutput,
}

impl WorkflowError {
    fn simple(kind: WorkflowErrorKind, message: impl Into<String>) -> Self {
        WorkflowError {
            kind,
            message: message.into(),
            stderr: None,
            exit_code: None,
        }
    }
    fn not_capable(message: impl Into<String>) -> Self {
        Self::simple(WorkflowErrorKind::NotCapable, message)
    }
    fn script_missing(message: impl Into<String>) -> Self {
        Self::simple(WorkflowErrorKind::ScriptMissing, message)
    }
    fn write_verb(message: impl Into<String>) -> Self {
        Self::simple(WorkflowErrorKind::WriteVerbForbidden, message)
    }
    fn unsupported(message: impl Into<String>) -> Self {
        Self::simple(WorkflowErrorKind::Unsupported, message)
    }
    fn spawn(message: impl Into<String>) -> Self {
        Self::simple(WorkflowErrorKind::Spawn, message)
    }
    fn bad_output(message: impl Into<String>) -> Self {
        Self::simple(WorkflowErrorKind::BadOutput, message)
    }
}

impl std::fmt::Display for WorkflowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)?;
        if let Some(code) = self.exit_code {
            write!(f, " (exit {code})")?;
        }
        if let Some(stderr) = &self.stderr {
            if !stderr.is_empty() {
                write!(f, ": {}", stderr.trim_end())?;
            }
        }
        Ok(())
    }
}

impl std::error::Error for WorkflowError {}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

/// The directory under a repo that holds the runnable `/workflow` scripts. We run
/// the SKILLS copy (the executable scripts); the COMMANDS dir is markdown
/// slash-command wrappers, so it only contributes to capability detection.
fn skills_dir(repo: &Path) -> PathBuf {
    repo.join(".claude/skills/workflow")
}

/// Resolve an allowlisted script's absolute path inside `repo`, erroring if the
/// repo is not capable or the script file is absent. This is the ONLY place a
/// script path is constructed, and it only ever joins one of the three known
/// basenames — never a caller-supplied filename.
fn resolve_script(repo: &Path, script: &str) -> Result<PathBuf, WorkflowError> {
    let cap = detect(repo);
    if !cap.capable {
        return Err(WorkflowError::not_capable(format!(
            "{} is not workflow-capable (no .claude/commands/workflow or .claude/skills/workflow)",
            repo.display()
        )));
    }
    let path = skills_dir(repo).join(script);
    if !path.is_file() {
        return Err(WorkflowError::script_missing(format!(
            "{} not found under {}/.claude/skills/workflow",
            script,
            repo.display()
        )));
    }
    Ok(path)
}

/// Run an allowlisted script with `args`, the child's cwd pinned to `repo`, and
/// capture stdout/stderr. On a nonzero exit, return a [`WorkflowErrorKind::ScriptFailed`]
/// carrying the captured stderr + exit code — never a blank result. On success,
/// return raw stdout (the caller decides whether it is markdown or a temp-file
/// path).
///
/// The argv is `[<abs script>, ...args]`; `args` is built solely from the typed
/// allowlist (a [`ReadVerb`] token + optional [`IssueType`]/key/epic), so a write
/// verb can never appear here.
fn run_script(repo: &Path, script: &str, args: &[&str]) -> Result<String, WorkflowError> {
    let script_path = resolve_script(repo, script)?;

    // Execute the script directly (it carries a `#!/usr/bin/env bash` shebang).
    // cwd = repo so the script's `git rev-parse --show-toplevel` resolves auth
    // against THIS repo's `.claude/settings.local.json`.
    let output = Command::new(&script_path)
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| {
            WorkflowError::spawn(format!("failed to spawn {}: {e}", script_path.display()))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(WorkflowError {
            kind: WorkflowErrorKind::ScriptFailed,
            message: format!("{script} exited with a nonzero status"),
            stderr: Some(stderr),
            exit_code: output.status.code(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Run a `jira_output`-style script (`epics.sh`/`issues.sh`) whose stdout is a
/// SINGLE LINE naming a temp JSON file. Read that file, JSON-parse it, DELETE it
/// (always, even on parse failure, so no `jira_*` artifact leaks), and return the
/// parsed value.
fn run_json_output(repo: &Path, script: &str, args: &[&str]) -> Result<Value, WorkflowError> {
    let stdout = run_script(repo, script, args)?;
    let path_line = stdout.trim();
    if path_line.is_empty() {
        return Err(WorkflowError::bad_output(format!(
            "{script} printed no temp-file path"
        )));
    }
    // The script may, in principle, print multiple lines; the jira_output contract
    // is that the LAST non-empty line is the path. Be tolerant and take it.
    let temp_path = path_line
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| WorkflowError::bad_output(format!("{script} printed no temp-file path")))?;

    // Read + parse, then ALWAYS delete (even if read/parse failed). We capture the
    // parse result first, remove the file, then surface either.
    let parsed = std::fs::read_to_string(&temp_path)
        .map_err(|e| {
            WorkflowError::bad_output(format!(
                "could not read temp file {}: {e}",
                temp_path.display()
            ))
        })
        .and_then(|text| {
            serde_json::from_str::<Value>(&text).map_err(|e| {
                WorkflowError::bad_output(format!(
                    "temp file {} is not valid JSON: {e}",
                    temp_path.display()
                ))
            })
        });

    // Cleanup is unconditional and best-effort. We only delete paths that look
    // like the jira_output temp file (under a temp dir, basename starting `jira_`)
    // would be ideal, but the contract is "delete the file the script named", so
    // we delete exactly the named path. A failure to delete is non-fatal.
    let _ = std::fs::remove_file(&temp_path);

    parsed
}

// ---------------------------------------------------------------------------
// Public command surface (all read-only).
// ---------------------------------------------------------------------------

/// `next.sh [epic]` — returns the script's MARKDOWN stdout verbatim. When `epic`
/// is `Some`, the board is scoped to that epic key (`next.sh <KEY>`); otherwise the
/// whole project (`next.sh`).
pub fn next(repo: &Path, epic: Option<&str>) -> Result<String, WorkflowError> {
    match epic {
        Some(key) => run_script(repo, NEXT_SCRIPT, &[key]),
        None => run_script(repo, NEXT_SCRIPT, &[]),
    }
}

/// `epics.sh list` — parse the temp-file JSON into an array of
/// `{key, summary, status}` epic objects.
pub fn epics_list(repo: &Path) -> Result<Value, WorkflowError> {
    run_json_output(repo, EPICS_SCRIPT, &[ReadVerb::List.as_str()])
}

/// `epics.sh get <key>` — parse the temp-file JSON into the epic object with its
/// children rollup `{key, summary, status, children:{total, by_status, issues}}`.
pub fn epic_get(repo: &Path, key: &str) -> Result<Value, WorkflowError> {
    run_json_output(repo, EPICS_SCRIPT, &[ReadVerb::Get.as_str(), key])
}

/// `issues.sh <type> list [epic]` — parse the temp-file JSON into an array of
/// `{key, summary, status, epic}` issue objects. `epic` optionally scopes the list
/// to one epic.
pub fn issues_list(
    repo: &Path,
    issue_type: IssueType,
    epic: Option<&str>,
) -> Result<Value, WorkflowError> {
    match epic {
        Some(key) => run_json_output(
            repo,
            ISSUES_SCRIPT,
            &[issue_type.as_str(), ReadVerb::List.as_str(), key],
        ),
        None => run_json_output(
            repo,
            ISSUES_SCRIPT,
            &[issue_type.as_str(), ReadVerb::List.as_str()],
        ),
    }
}

/// `issues.sh <type> get <key>` — parse the temp-file JSON into the issue object
/// with `{key, summary, status, epic, assignee, subtasks, blocked_by, blocks}`.
pub fn issue_get(repo: &Path, issue_type: IssueType, key: &str) -> Result<Value, WorkflowError> {
    run_json_output(
        repo,
        ISSUES_SCRIPT,
        &[issue_type.as_str(), ReadVerb::Get.as_str(), key],
    )
}

// ===========================================================================
// Tests — fixtures only; no real Jira / auth / network.
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    /// A throwaway dir under the system temp dir, removed on drop. Mirrors the
    /// convention in `usage.rs` / `task.rs`.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-workflow-{tag}-{nanos}"));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Write `body` to `<dir>/<rel>`, creating parent dirs, and (on Unix) make it
    /// executable so it can be spawned directly via its shebang.
    fn write_script(dir: &Path, rel: &str, body: &str) -> PathBuf {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, body).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    /// Make `<repo>/.claude/skills/workflow/` exist (so the repo is capable) and
    /// return the repo root. Caller adds whichever scripts a test needs.
    fn capable_repo(tmp: &TempDir) -> PathBuf {
        let repo = tmp.path().join("repo");
        fs::create_dir_all(repo.join(".claude/skills/workflow")).unwrap();
        repo
    }

    /// A `next.sh` that echoes a known Markdown blob (and a second arg echo so the
    /// epic-scoping test can assert the argument reached the script).
    const NEXT_MARKDOWN: &str = "\
#!/usr/bin/env bash
set -euo pipefail
echo '# What'\\''s Next'
echo ''
echo '## In Progress'
if [[ -n \"${1:-}\" ]]; then
  echo \"scope:$1\"
fi
";

    /// An `epics.sh list` that follows the jira_output pattern: it writes a JSON
    /// array to a temp file and prints ONLY that path. Mirrors `jira_output` in
    /// the real `jira.sh` (`${TMPDIR}/jira_<pid>_<ns>.json`).
    const EPICS_JIRA_OUTPUT: &str = "\
#!/usr/bin/env bash
set -euo pipefail
cmd=\"${1:-}\"
tmpfile=\"${TMPDIR:-/tmp}/jira_$$_$(date +%s%N).json\"
if [[ \"$cmd\" == \"get\" ]]; then
  cat > \"$tmpfile\" <<'JSON'
{\"key\":\"SKIPA-1\",\"summary\":\"Epic One\",\"status\":\"In Progress\",\"description\":null,\"children\":{\"total\":2,\"by_status\":[{\"status\":\"To Do\",\"count\":1},{\"status\":\"Done\",\"count\":1}],\"issues\":[{\"key\":\"SKIPA-2\",\"summary\":\"Child A\",\"status\":\"To Do\",\"type\":\"Task\"},{\"key\":\"SKIPA-3\",\"summary\":\"Child B\",\"status\":\"Done\",\"type\":\"Feature\"}]}}
JSON
else
  cat > \"$tmpfile\" <<'JSON'
[{\"key\":\"SKIPA-1\",\"summary\":\"Epic One\",\"status\":\"In Progress\"},{\"key\":\"SKIPA-4\",\"summary\":\"Epic Two\",\"status\":\"To Do\"}]
JSON
fi
echo \"$tmpfile\"
";

    /// An `issues.sh <type> get <key>` jira_output script producing the issue
    /// superset shape (assignee + subtasks + blocked_by + blocks).
    const ISSUES_JIRA_OUTPUT: &str = "\
#!/usr/bin/env bash
set -euo pipefail
type=\"${1:-}\"
cmd=\"${2:-}\"
tmpfile=\"${TMPDIR:-/tmp}/jira_$$_$(date +%s%N).json\"
if [[ \"$cmd\" == \"get\" ]]; then
  cat > \"$tmpfile\" <<'JSON'
{\"key\":\"SKIPA-2\",\"summary\":\"Child A\",\"status\":\"To Do\",\"epic\":\"SKIPA-1\",\"description\":null,\"assignee\":{\"account_id\":\"acc-1\",\"display_name\":\"Arthur P\"},\"subtasks\":[{\"key\":\"SKIPA-5\",\"summary\":\"Sub\",\"status\":\"To Do\"}],\"blocked_by\":[{\"key\":\"SKIPA-9\",\"summary\":\"Blocker\",\"status\":\"In Progress\"}],\"blocks\":[]}
JSON
else
  cat > \"$tmpfile\" <<'JSON'
[{\"key\":\"SKIPA-2\",\"summary\":\"Child A\",\"status\":\"To Do\",\"epic\":\"SKIPA-1\"}]
JSON
fi
echo \"$tmpfile\"
";

    // -- Workflow Capability Detection ------------------------------------------

    #[test]
    fn repo_with_workflow_skills_directory_is_detected() {
        let tmp = TempDir::new("detect-skills");
        let repo = capable_repo(&tmp);
        let cap = detect(&repo);
        assert!(cap.capable, "skills/workflow makes the repo capable");
        assert!(cap.has_skills);
        assert!(!cap.has_commands);
    }

    #[test]
    fn repo_with_only_the_commands_directory_is_detected() {
        let tmp = TempDir::new("detect-commands");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(repo.join(".claude/commands/workflow")).unwrap();
        let cap = detect(&repo);
        assert!(cap.capable, "commands/workflow alone is still capable");
        assert!(cap.has_commands);
        assert!(!cap.has_skills);
    }

    #[test]
    fn repo_without_workflow_tooling_shows_no_board() {
        let tmp = TempDir::new("detect-none");
        let repo = tmp.path().join("repo");
        fs::create_dir_all(repo.join(".claude")).unwrap(); // .claude exists but no workflow dir
        let cap = detect(&repo);
        assert!(!cap.capable, "no workflow tooling => not capable");
        assert!(!cap.has_commands);
        assert!(!cap.has_skills);

        // And the runner refuses to run anything for a non-capable repo (so the
        // app never spawns a workflow script for it).
        let err = next(&repo, None).unwrap_err();
        assert_eq!(err.kind, WorkflowErrorKind::NotCapable);
    }

    // -- Run Repo Scripts Read-Only With Repo As Working Directory --------------

    #[test]
    fn scripts_run_from_the_repos_own_path_with_cwd_repo() {
        let tmp = TempDir::new("cwd");
        let repo = capable_repo(&tmp);
        // This script prints its own $0 (the path it was invoked as) and its cwd.
        write_script(
            &repo,
            ".claude/skills/workflow/next.sh",
            "#!/usr/bin/env bash\nset -euo pipefail\necho \"argv0=$0\"\necho \"cwd=$(pwd -P)\"\n",
        );
        let out = next(&repo, None).expect("runs");
        // cwd is the repo root (resolve symlinks so /var vs /private/var on macOS
        // doesn't trip the comparison).
        let canon_repo = fs::canonicalize(&repo).unwrap();
        assert!(
            out.contains(&format!("cwd={}", canon_repo.display())),
            "child cwd must be the repo root; got: {out}"
        );
        // It ran the repo's OWN copy of the script (path is under the repo).
        assert!(
            out.contains("argv0=") && out.contains(".claude/skills/workflow/next.sh"),
            "must invoke the repo's own script path; got: {out}"
        );
        assert!(
            out.contains(canon_repo.to_string_lossy().as_ref())
                || out.contains(repo.to_string_lossy().as_ref()),
            "the invoked script path is inside the repo; got: {out}"
        );
    }

    #[test]
    fn repo_specific_auth_resolves_against_the_running_repo() {
        let tmp = TempDir::new("auth-repo");
        let repo = capable_repo(&tmp);
        // Place a settings file in the repo and a DIFFERENT one one level up; a
        // script that resolves "the repo root settings" via the cwd must read the
        // repo's. We emulate the real jira.sh auth resolution: it joins
        // `git rev-parse --show-toplevel` — but in a fixture (no git) we instead
        // resolve relative to cwd, which IS the repo because we set current_dir.
        fs::write(
            repo.join(".claude/settings.local.json"),
            r#"{"env":{"JIRA_USER_EMAIL":"repo@example.com","JIRA_API_TOKEN":"tok"}}"#,
        )
        .unwrap();
        // A sibling settings file that must NOT be the one resolved.
        fs::write(
            tmp.path().join("settings.local.json"),
            r#"{"env":{"JIRA_USER_EMAIL":"WRONG@example.com"}}"#,
        )
        .unwrap();
        write_script(
            &repo,
            ".claude/skills/workflow/next.sh",
            "#!/usr/bin/env bash\nset -euo pipefail\n\
             SETTINGS=\"$(pwd)/.claude/settings.local.json\"\n\
             if [[ ! -f \"$SETTINGS\" ]]; then echo 'ERROR: settings.local.json not found' >&2; exit 1; fi\n\
             email=$(grep -o '\"JIRA_USER_EMAIL\":\"[^\"]*\"' \"$SETTINGS\")\n\
             echo \"resolved:$email\"\n",
        );
        let out = next(&repo, None).expect("runs against repo settings");
        assert!(
            out.contains("repo@example.com"),
            "auth must resolve to the repo's own settings.local.json; got: {out}"
        );
        assert!(!out.contains("WRONG@example.com"));
    }

    // -- Render next.sh Markdown Output Directly ---------------------------------

    #[test]
    fn next_sh_stdout_rendered_as_markdown() {
        let tmp = TempDir::new("next-md");
        let repo = capable_repo(&tmp);
        write_script(&repo, ".claude/skills/workflow/next.sh", NEXT_MARKDOWN);
        let md = next(&repo, None).expect("runs");
        // Returned verbatim as markdown — no temp-file indirection, no parsing.
        assert!(md.contains("# What's Next"), "got: {md}");
        assert!(md.contains("## In Progress"), "got: {md}");
        // No epic scope when called without one.
        assert!(
            !md.contains("scope:"),
            "unscoped next has no scope line: {md}"
        );
    }

    #[test]
    fn next_sh_scoped_to_an_epic() {
        let tmp = TempDir::new("next-epic");
        let repo = capable_repo(&tmp);
        write_script(&repo, ".claude/skills/workflow/next.sh", NEXT_MARKDOWN);
        let md = next(&repo, Some("SKIPA-1")).expect("runs");
        // The epic key reached the script as $1.
        assert!(
            md.contains("scope:SKIPA-1"),
            "epic key must be passed to next.sh as its arg; got: {md}"
        );
    }

    // -- Parse Temp-File-Path JSON Outputs ---------------------------------------

    #[test]
    fn list_output_parsed_from_the_referenced_temp_file() {
        let tmp = TempDir::new("list-json");
        let repo = capable_repo(&tmp);
        write_script(&repo, ".claude/skills/workflow/epics.sh", EPICS_JIRA_OUTPUT);
        let value = epics_list(&repo).expect("parses");
        let arr = value.as_array().expect("epics list is a JSON array");
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["key"], "SKIPA-1");
        assert_eq!(arr[0]["summary"], "Epic One");
        assert_eq!(arr[0]["status"], "In Progress");
        assert_eq!(arr[1]["key"], "SKIPA-4");
    }

    #[test]
    fn epic_get_output_parsed_with_children_rollup() {
        let tmp = TempDir::new("epic-get");
        let repo = capable_repo(&tmp);
        write_script(&repo, ".claude/skills/workflow/epics.sh", EPICS_JIRA_OUTPUT);
        let v = epic_get(&repo, "SKIPA-1").expect("parses");
        assert_eq!(v["key"], "SKIPA-1");
        assert_eq!(v["summary"], "Epic One");
        assert_eq!(v["status"], "In Progress");
        let children = &v["children"];
        assert_eq!(children["total"], 2);
        let by_status = children["by_status"].as_array().unwrap();
        assert_eq!(by_status.len(), 2);
        assert_eq!(by_status[0]["status"], "To Do");
        assert_eq!(by_status[0]["count"], 1);
        let issues = children["issues"].as_array().unwrap();
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0]["key"], "SKIPA-2");
        assert_eq!(issues[0]["type"], "Task");
    }

    #[test]
    fn issue_get_adds_assignee_and_link_fields() {
        let tmp = TempDir::new("issue-get");
        let repo = capable_repo(&tmp);
        write_script(
            &repo,
            ".claude/skills/workflow/issues.sh",
            ISSUES_JIRA_OUTPUT,
        );
        let v = issue_get(&repo, IssueType::Task, "SKIPA-2").expect("parses");
        assert_eq!(v["key"], "SKIPA-2");
        assert_eq!(v["epic"], "SKIPA-1");
        // assignee = {account_id, display_name}
        assert_eq!(v["assignee"]["account_id"], "acc-1");
        assert_eq!(v["assignee"]["display_name"], "Arthur P");
        // plus subtasks[], blocked_by[], blocks[]
        assert_eq!(v["subtasks"].as_array().unwrap().len(), 1);
        assert_eq!(v["blocked_by"].as_array().unwrap()[0]["key"], "SKIPA-9");
        assert!(v["blocks"].as_array().unwrap().is_empty());

        // And a list call yields the {key,summary,status,epic} array.
        let list = issues_list(&repo, IssueType::Task, None).expect("parses");
        let arr = list.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["epic"], "SKIPA-1");
    }

    // -- Temp-File Cleanup -------------------------------------------------------

    #[test]
    fn temp_json_deleted_after_successful_parse() {
        let tmp = TempDir::new("cleanup-ok");
        let repo = capable_repo(&tmp);
        // A script that writes the temp file at a path WE choose so the test can
        // check it afterwards.
        let temp_target = tmp.path().join("jira_output_ok.json");
        let script = format!(
            "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s' '[{{\"key\":\"X\"}}]' > '{}'\necho '{}'\n",
            temp_target.display(),
            temp_target.display()
        );
        write_script(&repo, ".claude/skills/workflow/epics.sh", &script);
        assert!(!temp_target.exists(), "precondition: temp file absent");
        let _ = epics_list(&repo).expect("parses");
        assert!(
            !temp_target.exists(),
            "temp file must be deleted after a successful parse"
        );
    }

    #[test]
    fn temp_json_deleted_on_parse_failure() {
        let tmp = TempDir::new("cleanup-bad");
        let repo = capable_repo(&tmp);
        let temp_target = tmp.path().join("jira_output_bad.json");
        // Write NON-JSON to the temp file so parsing fails — cleanup must still run.
        let script = format!(
            "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s' 'this is not json{{' > '{}'\necho '{}'\n",
            temp_target.display(),
            temp_target.display()
        );
        write_script(&repo, ".claude/skills/workflow/epics.sh", &script);
        let err = epics_list(&repo).expect_err("parse must fail");
        assert_eq!(err.kind, WorkflowErrorKind::BadOutput);
        assert!(
            !temp_target.exists(),
            "temp file must be deleted even when parsing fails (no leak)"
        );
    }

    // -- Read-Only Guarantee — No Write Verbs -----------------------------------

    #[test]
    fn write_verbs_are_never_spawned() {
        let tmp = TempDir::new("readonly");
        let repo = capable_repo(&tmp);
        // Install a write-capable issues.sh that drops a sentinel if ever run with
        // a mutating verb. Also install the legit read script body so list/get work.
        let issues_body = format!(
            "#!/usr/bin/env bash\nset -euo pipefail\ntype=\"${{1:-}}\"\ncmd=\"${{2:-}}\"\n\
             case \"$cmd\" in\n  create|update|transition|rank|delete) touch \"$(pwd)/WRITE_HAPPENED\"; exit 0 ;;\nesac\n{}",
            // reuse the read jira_output tail for list/get
            "tmpfile=\"${TMPDIR:-/tmp}/jira_$$_$(date +%s%N).json\"\nprintf '%s' '[]' > \"$tmpfile\"\necho \"$tmpfile\"\n"
        );
        write_script(&repo, ".claude/skills/workflow/issues.sh", &issues_body);

        // 1) The allowlist rejects every write verb at the string boundary, before
        //    any spawn — so there is no argv that carries a write verb.
        for verb in ["create", "update", "transition", "rank", "delete"] {
            let err = parse_read_verb(verb).expect_err("write verb must be rejected");
            assert_eq!(
                err.kind,
                WorkflowErrorKind::WriteVerbForbidden,
                "{verb} must be rejected as a write verb"
            );
        }
        // An unknown verb is rejected too.
        assert!(parse_read_verb("frobnicate").is_err());

        // 2) Read verbs are accepted and only ever map to "list"/"get".
        assert_eq!(parse_read_verb("list").unwrap().as_str(), "list");
        assert_eq!(parse_read_verb("get").unwrap().as_str(), "get");

        // 3) Exercising the ENTIRE public command surface never creates the
        //    sentinel — proving no public path spawns a write verb.
        let _ = issues_list(&repo, IssueType::Feature, None);
        let _ = issue_get(&repo, IssueType::Bug, "SKIPA-2");
        let _ = epics_list(&repo);
        let _ = epic_get(&repo, "SKIPA-1");
        let _ = next(&repo, None);
        assert!(
            !repo.join("WRITE_HAPPENED").exists(),
            "no public command may ever spawn a write verb"
        );

        // 4) Unsupported issue types are rejected before any spawn.
        assert!(IssueType::parse("subtask").is_err());
        assert!(IssueType::parse("feature").is_ok());
    }

    #[test]
    fn no_automatic_slash_command_execution() {
        // The board surface is exactly the five read functions; none of them
        // resolves or runs a `/workflow:*` slash command. There is no API on this
        // module that takes a slash-command string, and the only scripts it can
        // resolve are the three allowlisted basenames. We assert the closure: a
        // capable repo whose ONLY runnable artifacts are the read scripts produces
        // no side effects beyond reading.
        let tmp = TempDir::new("no-slash");
        let repo = capable_repo(&tmp);
        // A commands/workflow dir full of slash-command markdown must NEVER be
        // executed (it is detection-only).
        fs::create_dir_all(repo.join(".claude/commands/workflow")).unwrap();
        write_script(
            &repo,
            ".claude/commands/workflow/start.md",
            "this is a slash command body, not executable",
        );
        write_script(&repo, ".claude/skills/workflow/next.sh", NEXT_MARKDOWN);
        // The runner only ever runs skills scripts; the markdown command file is
        // inert. next() returns markdown, and nothing under commands/ was run.
        let md = next(&repo, None).expect("runs next.sh only");
        assert!(md.contains("# What's Next"));
        // Detection still reports the command dir, but it was not executed.
        let cap = detect(&repo);
        assert!(cap.has_commands && cap.has_skills);
    }

    // -- Surface Auth And Exit-Code Errors --------------------------------------

    #[test]
    fn missing_settings_file_surfaces_an_error() {
        let tmp = TempDir::new("missing-settings");
        let repo = capable_repo(&tmp);
        // Mirror jira.sh: missing settings.local.json => ERROR to stderr, exit 1.
        write_script(
            &repo,
            ".claude/skills/workflow/epics.sh",
            "#!/usr/bin/env bash\nset -euo pipefail\n\
             echo 'ERROR: settings.local.json not found at /repo/.claude/settings.local.json' >&2\nexit 1\n",
        );
        let err = epics_list(&repo).expect_err("nonzero exit => structured error");
        assert_eq!(err.kind, WorkflowErrorKind::ScriptFailed);
        assert_eq!(err.exit_code, Some(1));
        let stderr = err.stderr.as_deref().unwrap_or_default();
        assert!(
            stderr.contains("settings.local.json not found"),
            "stderr must carry the actionable ERROR line; got: {stderr:?}"
        );
    }

    #[test]
    fn empty_token_surfaces_an_error() {
        let tmp = TempDir::new("empty-token");
        let repo = capable_repo(&tmp);
        // Mirror jira.sh: empty JIRA_USER_EMAIL/JIRA_API_TOKEN => ERROR, exit 1.
        write_script(
            &repo,
            ".claude/skills/workflow/epics.sh",
            "#!/usr/bin/env bash\nset -euo pipefail\n\
             echo 'ERROR: JIRA_USER_EMAIL or JIRA_API_TOKEN not found in settings.local.json' >&2\nexit 1\n",
        );
        let err = epics_list(&repo).expect_err("nonzero exit => structured error");
        assert_eq!(err.kind, WorkflowErrorKind::ScriptFailed);
        assert_eq!(err.exit_code, Some(1));
        assert!(err
            .stderr
            .as_deref()
            .unwrap_or_default()
            .contains("JIRA_USER_EMAIL or JIRA_API_TOKEN not found"));
        // The error is structured, NOT an empty board (the function returned Err,
        // not Ok(empty array)).
        assert!(epics_list(&repo).is_err());
    }

    // -- On-Demand Board Refresh -------------------------------------------------

    #[test]
    fn refresh_re_runs_the_read_scripts() {
        // "Refresh" = re-invoking the same read command, which re-runs the script
        // with cwd=repo and returns fresh data. We prove the command is
        // re-runnable AND reflects the script's current output (a refresh after the
        // underlying data changes shows the new value).
        let tmp = TempDir::new("refresh");
        let repo = capable_repo(&tmp);
        // The script's output is driven by a file the test mutates between calls,
        // standing in for Jira state changing between refreshes.
        let state = tmp.path().join("state.json");
        fs::write(
            &state,
            r#"[{"key":"SKIPA-1","summary":"v1","status":"To Do"}]"#,
        )
        .unwrap();
        let script = format!(
            "#!/usr/bin/env bash\nset -euo pipefail\ntmpfile=\"${{TMPDIR:-/tmp}}/jira_$$_$(date +%s%N).json\"\ncat '{}' > \"$tmpfile\"\necho \"$tmpfile\"\n",
            state.display()
        );
        write_script(&repo, ".claude/skills/workflow/epics.sh", &script);

        let first = epics_list(&repo).expect("first run");
        assert_eq!(first.as_array().unwrap()[0]["summary"], "v1");

        // Underlying data changes; a refresh re-runs the script and returns it.
        fs::write(
            &state,
            r#"[{"key":"SKIPA-1","summary":"v2","status":"Done"}]"#,
        )
        .unwrap();
        let second = epics_list(&repo).expect("refresh run");
        assert_eq!(
            second.as_array().unwrap()[0]["summary"],
            "v2",
            "refresh must re-run the script and replace the data"
        );
        assert_eq!(second.as_array().unwrap()[0]["status"], "Done");
    }

    // -- Detection error path for missing script in a capable repo --------------

    #[test]
    fn capable_repo_missing_script_is_a_structured_error() {
        let tmp = TempDir::new("missing-script");
        let repo = capable_repo(&tmp); // capable (dir exists) but no next.sh on disk
        let err = next(&repo, None).expect_err("absent script => error, not panic");
        assert_eq!(err.kind, WorkflowErrorKind::ScriptMissing);
    }

    /// A `jira_output` script that prints a path to a file that does not exist:
    /// the runner surfaces a structured BadOutput error rather than panicking.
    #[test]
    fn missing_temp_file_is_a_structured_error() {
        let tmp = TempDir::new("missing-temp");
        let repo = capable_repo(&tmp);
        write_script(
            &repo,
            ".claude/skills/workflow/epics.sh",
            "#!/usr/bin/env bash\nset -euo pipefail\necho '/no/such/jira_output.json'\n",
        );
        let err = epics_list(&repo).expect_err("missing temp file => error");
        assert_eq!(err.kind, WorkflowErrorKind::BadOutput);
    }
}
