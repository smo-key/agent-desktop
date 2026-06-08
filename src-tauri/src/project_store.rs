//! Per-project on-disk store under `<project_path>/.agent-desktop/` for the
//! project-scoped `tasks.json` and `config.json` documents.
//!
//! Unlike the legacy USER-level store (the `tasks.json` under `<app_data_dir>`,
//! handled by `tasks_load`/`tasks_save` in `lib.rs`), this store lives BESIDE the
//! project's own files, so a project's tasks and config travel with the repo. It
//! is split the same way as [`crate::specialists`]:
//!
//!   1. A PURE core over a given `project_path: &Path` — path resolution
//!      ([`agent_desktop_dir`]) and the load/save/clear operations for the two
//!      documents — all testable WITHOUT Tauri (temp-dir tests below).
//!
//!   2. Thin `#[tauri::command]` wrappers (in `lib.rs`) over that core.
//!
//! The module traffics in RAW JSON STRINGS: it never parses the documents itself,
//! mirroring how [`crate::specialists`] traffics in raw file contents. A missing
//! `.agent-desktop/` dir or file is reported as `Ok(None)` (not yet written), and
//! writes use an ATOMIC sibling-temp-file + rename, exactly like
//! [`crate::specialists::write_specialist`] / [`crate::lib::write_app_data_json`].

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// The `.agent-desktop/` directory under a project path.
fn agent_desktop_dir(project_path: &Path) -> PathBuf {
    project_path.join(".agent-desktop")
}

/// Read the raw JSON at `<project_path>/.agent-desktop/<file>`, or `Ok(None)` when
/// the file (or the `.agent-desktop/` dir) does not exist yet. Any other IO error
/// is surfaced so the frontend can fall back rather than crash.
fn load_file(project_path: &Path, file: &str) -> Result<Option<String>, String> {
    let path = agent_desktop_dir(project_path).join(file);
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {path:?}: {e}")),
    }
}

/// Create/overwrite `<project_path>/.agent-desktop/<file>` with `json`, creating
/// the `.agent-desktop/` dir if needed. Uses an ATOMIC write (sibling temp file +
/// rename) so a crash mid-write never leaves a truncated file, mirroring
/// [`crate::specialists::write_specialist`]. `Err` when any IO step fails.
fn save_file(project_path: &Path, file: &str, json: &str) -> Result<(), String> {
    let dir = agent_desktop_dir(project_path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;
    let path = dir.join(file);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))?;
    Ok(())
}

/// Remove `<project_path>/.agent-desktop/<file>`. Deleting a nonexistent file is a
/// NO-OP (not an error). `Err` only when removal fails for a reason other than
/// not-found.
fn clear_file(project_path: &Path, file: &str) -> Result<(), String> {
    let path = agent_desktop_dir(project_path).join(file);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()), // no-op.
        Err(e) => Err(format!("remove {path:?}: {e}")),
    }
}

/// Load the project's `.agent-desktop/tasks.json`, or `Ok(None)` when it (or the
/// dir) does not exist yet. See [`load_file`].
pub fn load_tasks(project_path: &Path) -> Result<Option<String>, String> {
    load_file(project_path, "tasks.json")
}

/// Atomically persist the project's `.agent-desktop/tasks.json`. See [`save_file`].
pub fn save_tasks(project_path: &Path, json: &str) -> Result<(), String> {
    save_file(project_path, "tasks.json", json)
}

/// Load the project's `.agent-desktop/config.json`, or `Ok(None)` when it (or the
/// dir) does not exist yet. See [`load_file`].
pub fn load_config(project_path: &Path) -> Result<Option<String>, String> {
    load_file(project_path, "config.json")
}

/// Atomically persist the project's `.agent-desktop/config.json`. See [`save_file`].
pub fn save_config(project_path: &Path, json: &str) -> Result<(), String> {
    save_file(project_path, "config.json", json)
}

/// Remove the project's `.agent-desktop/tasks.json`. Deleting a nonexistent file
/// is a NO-OP. Provided for parity/migration symmetry with the user-level clear
/// (a separate `tasks_clear` command in `lib.rs`). See [`clear_file`].
pub fn clear_tasks(project_path: &Path) -> Result<(), String> {
    clear_file(project_path, "tasks.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A monotonic per-test counter. Combined with the process id it yields a
    /// unique temp subdir per test WITHOUT pulling in `rand`.
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A throwaway dir under the system temp dir, removed on drop. Mirrors the
    /// helper in [`crate::specialists`] tests.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("agentdesk-projectstore-{tag}-{}-{n}", process::id()));
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

    const TASKS_JSON: &str = r#"{"tasks":[{"id":"a","label":"Build"}]}"#;
    const CONFIG_JSON: &str = r#"{"autoWorktree":true,"branchPrefix":"feat/"}"#;

    /// Loading tasks from a project with no `.agent-desktop/` dir yields `None`
    /// (Ok(None)), not an error. (Scenario: Load missing file.)
    #[test]
    fn load_missing_file() {
        let tmp = TempDir::new("tasks-missing");
        assert_eq!(load_tasks(tmp.path()).unwrap(), None);
    }

    /// Loading config from a project with no `.agent-desktop/` dir yields `None`.
    #[test]
    fn load_config_missing_is_none() {
        let tmp = TempDir::new("config-missing");
        assert_eq!(load_config(tmp.path()).unwrap(), None);
    }

    /// Save-then-load round-trips the EXACT JSON string for tasks.
    #[test]
    fn save_then_load_tasks_round_trip() {
        let tmp = TempDir::new("tasks-roundtrip");
        save_tasks(tmp.path(), TASKS_JSON).unwrap();
        assert_eq!(load_tasks(tmp.path()).unwrap().as_deref(), Some(TASKS_JSON));
    }

    /// Saving creates the `.agent-desktop/` dir when it doesn't exist yet and
    /// lands the file at `<project>/.agent-desktop/tasks.json`.
    /// (Scenario: Directory location.)
    #[test]
    fn directory_location() {
        let tmp = TempDir::new("createdir");
        let dir = agent_desktop_dir(tmp.path());
        assert!(!dir.exists(), "agent-desktop dir absent before save");
        save_tasks(tmp.path(), TASKS_JSON).unwrap();
        assert!(dir.exists(), "agent-desktop dir created by save");
        assert!(dir.join("tasks.json").is_file(), "file at tasks.json");
    }

    /// The atomic write (sibling temp file + rename) leaves the target in place
    /// and NO `.json.tmp` sibling behind. (Scenario: Atomic save.)
    #[test]
    fn atomic_save() {
        let tmp = TempDir::new("atomic");
        save_tasks(tmp.path(), TASKS_JSON).unwrap();
        let dir = agent_desktop_dir(tmp.path());
        assert!(dir.join("tasks.json").is_file(), "target file present");
        assert!(
            !dir.join("tasks.json.tmp").exists(),
            "no temp file left after atomic rename"
        );
    }

    /// The store never writes a `.gitignore`: a project's tasks/config travel
    /// with the repo, so the project dir gains no ignore file from a save.
    /// (Scenario: Not gitignored.)
    #[test]
    fn not_gitignored() {
        let tmp = TempDir::new("gitignore");
        save_tasks(tmp.path(), TASKS_JSON).unwrap();
        assert!(
            !tmp.path().join(".gitignore").exists(),
            "store writes no .gitignore in the project dir"
        );
        assert!(
            !agent_desktop_dir(tmp.path()).join(".gitignore").exists(),
            "store writes no .gitignore in .agent-desktop"
        );
    }

    /// Clearing removes the tasks file; a SECOND clear (file already gone) is a
    /// no-op (Ok), not an error.
    #[test]
    fn clear_tasks_removes_then_is_a_no_op() {
        let tmp = TempDir::new("clear");
        save_tasks(tmp.path(), TASKS_JSON).unwrap();
        assert!(load_tasks(tmp.path()).unwrap().is_some());
        clear_tasks(tmp.path()).unwrap();
        assert_eq!(load_tasks(tmp.path()).unwrap(), None, "file removed");
        // Second clear of an already-absent file is a no-op.
        clear_tasks(tmp.path()).unwrap();
    }

    /// Clearing tasks in a project with no `.agent-desktop/` dir at all is a no-op.
    #[test]
    fn clear_tasks_on_missing_dir_is_a_no_op() {
        let tmp = TempDir::new("clear-missing");
        clear_tasks(tmp.path()).unwrap();
    }

    /// The config document round-trips INDEPENDENTLY of tasks — writing config
    /// doesn't disturb tasks and vice versa.
    #[test]
    fn config_round_trips_independently_of_tasks() {
        let tmp = TempDir::new("independent");
        save_tasks(tmp.path(), TASKS_JSON).unwrap();
        save_config(tmp.path(), CONFIG_JSON).unwrap();
        assert_eq!(load_config(tmp.path()).unwrap().as_deref(), Some(CONFIG_JSON));
        assert_eq!(load_tasks(tmp.path()).unwrap().as_deref(), Some(TASKS_JSON));
        // Clearing tasks leaves config untouched.
        clear_tasks(tmp.path()).unwrap();
        assert_eq!(load_tasks(tmp.path()).unwrap(), None);
        assert_eq!(load_config(tmp.path()).unwrap().as_deref(), Some(CONFIG_JSON));
    }
}
