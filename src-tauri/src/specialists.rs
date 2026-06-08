//! Specialist (native Claude Code subagent) file management for the
//! `agent-specialists` capability (Milestone 2, task 2.3).
//!
//! A project's SPECIALISTS are the native Claude Code subagent files living at
//! `<project_path>/.claude/agents/*.md`. Each file is a YAML-frontmatter `.md`
//! document (parsed/serialized on the FRONTEND by `specialists.ts`); this module
//! traffics in RAW FILE CONTENTS (strings) keyed by name and never parses YAML
//! itself.
//!
//! The module is split the same way as [`crate::task`] / [`crate::subagents`]:
//!
//!   1. A PURE core — name-safety ([`safe_component`]), path resolution
//!      ([`agents_dir`], [`specialist_path`]), and the four IO operations
//!      ([`list_specialists`], [`read_specialist`], [`write_specialist`],
//!      [`delete_specialist`]) — all over a given `project_path: &Path`, so they
//!      are unit-testable WITHOUT Tauri (temp-dir tests below).
//!
//!   2. Thin `#[tauri::command]` wrappers (in `lib.rs`) over that core.
//!
//! All operations stay within `<project_path>/.claude/agents/`: a `name` that is
//! not a safe single path component (contains `/`, `\`, `..`, or is empty) is
//! rejected BEFORE touching the filesystem, mirroring the guard in
//! [`crate::subagents`].

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// One specialist file surfaced to the frontend: its `name` (the `.md` basename
/// without extension) and the RAW file `content` (the store parses it via
/// `parseSpecialist`). Serialized camelCase for the JS side, matching the repo
/// convention.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialistFile {
    /// The specialist name = the `.md` file's basename without extension.
    pub name: String,
    /// The raw `.md` file contents (frontmatter + body), parsed on the frontend.
    pub content: String,
}

/// Reject a `name` that is not a safe single path component (could escape the
/// agents dir): empty, or containing a path separator or `..`. Returns the
/// trimmed name when safe. Mirrors `safe_component` in [`crate::subagents`].
fn safe_component(name: &str) -> Option<&str> {
    let t = name.trim();
    if t.is_empty() || t.contains('/') || t.contains('\\') || t.contains("..") {
        None
    } else {
        Some(t)
    }
}

/// The `.claude/agents/` directory under a project path.
fn agents_dir(project_path: &Path) -> PathBuf {
    project_path.join(".claude").join("agents")
}

/// Resolve the absolute path to `<project_path>/.claude/agents/<name>.md`, or
/// `None` when `name` is not a safe single path component.
fn specialist_path(project_path: &Path, name: &str) -> Option<PathBuf> {
    let safe = safe_component(name)?;
    Some(agents_dir(project_path).join(format!("{safe}.md")))
}

/// List the specialist files under `<project_path>/.claude/agents/`. Returns one
/// [`SpecialistFile`] per readable top-level `*.md` file, with `name` the
/// basename without extension and `content` the raw file text. Results are sorted
/// by `name` for a stable order. A missing/unreadable `.claude/agents/` dir
/// yields an EMPTY list, not an error. A file that can't be read is skipped (the
/// rest survive). Never panics.
pub fn list_specialists(project_path: &Path) -> Vec<SpecialistFile> {
    let mut out = Vec::new();
    let dir = agents_dir(project_path);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out; // missing/unreadable dir -> empty list.
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_md = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("md"));
        if !is_md {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else {
            continue;
        };
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue; // unreadable -> skip this file, keep the rest.
        };
        out.push(SpecialistFile { name, content });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Read the raw `.md` contents of `<project_path>/.claude/agents/<name>.md`.
/// `Err` when `name` is unsafe or the file can't be read.
pub fn read_specialist(project_path: &Path, name: &str) -> Result<String, String> {
    let path =
        specialist_path(project_path, name).ok_or_else(|| format!("unsafe specialist name: {name:?}"))?;
    std::fs::read_to_string(&path).map_err(|e| format!("read {path:?}: {e}"))
}

/// Create/overwrite `<project_path>/.claude/agents/<name>.md` with `content`,
/// creating the `.claude/agents/` dir if needed. Uses an ATOMIC write (sibling
/// temp file + rename) so a crash mid-write never leaves a truncated file,
/// mirroring [`crate::lib::write_app_data_json`]. `Err` when `name` is unsafe or
/// any IO step fails.
pub fn write_specialist(project_path: &Path, name: &str, content: &str) -> Result<(), String> {
    let path =
        specialist_path(project_path, name).ok_or_else(|| format!("unsafe specialist name: {name:?}"))?;
    let dir = agents_dir(project_path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))?;
    Ok(())
}

/// Remove `<project_path>/.claude/agents/<name>.md`. Deleting a nonexistent file
/// is a NO-OP (not an error). `Err` only when `name` is unsafe or removal fails
/// for a reason other than not-found.
pub fn delete_specialist(project_path: &Path, name: &str) -> Result<(), String> {
    let path =
        specialist_path(project_path, name).ok_or_else(|| format!("unsafe specialist name: {name:?}"))?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), // no-op.
        Err(e) => Err(format!("remove {path:?}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A throwaway dir under the system temp dir, removed on drop. Mirrors the
    /// helper in [`crate::task`]/[`crate::subagents`] tests.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!("agentdesk-specialists-{tag}-{nanos}"));
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

    const SAMPLE: &str = "---\nname: reviewer\ndescription: Reviews code\n---\nYou review code.";

    /// A project with no `.claude/agents/` dir lists EMPTY, not an error.
    #[test]
    fn list_on_missing_dir_is_empty() {
        let tmp = TempDir::new("missing");
        assert!(list_specialists(tmp.path()).is_empty());
    }

    /// Write-then-read round-trips the raw contents, and list surfaces it by name.
    #[test]
    fn write_then_read_round_trip() {
        let tmp = TempDir::new("roundtrip");
        write_specialist(tmp.path(), "reviewer", SAMPLE).unwrap();
        assert_eq!(read_specialist(tmp.path(), "reviewer").unwrap(), SAMPLE);

        let listed = list_specialists(tmp.path());
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "reviewer");
        assert_eq!(listed[0].content, SAMPLE);
    }

    /// Writing creates the `.claude/agents/` dir when it doesn't exist yet, and
    /// the file lands at the expected `<name>.md` path.
    #[test]
    fn write_creates_the_dir() {
        let tmp = TempDir::new("createdir");
        let dir = tmp.path().join(".claude").join("agents");
        assert!(!dir.exists(), "agents dir absent before write");
        write_specialist(tmp.path(), "tester", SAMPLE).unwrap();
        assert!(dir.exists(), "agents dir created by write");
        assert!(dir.join("tester.md").is_file(), "file at <name>.md");
        // No temp file left behind after the atomic rename.
        assert!(!dir.join("tester.md.tmp").exists());
    }

    /// List sorts by name and skips non-`.md` files.
    #[test]
    fn list_sorts_and_filters_non_md() {
        let tmp = TempDir::new("sort");
        write_specialist(tmp.path(), "zeta", SAMPLE).unwrap();
        write_specialist(tmp.path(), "alpha", SAMPLE).unwrap();
        // A stray non-md file in the dir must be ignored.
        let dir = tmp.path().join(".claude").join("agents");
        std::fs::write(dir.join("README.txt"), "not a specialist").unwrap();

        let listed = list_specialists(tmp.path());
        let names: Vec<&str> = listed.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "zeta"]);
    }

    /// Delete removes the file.
    #[test]
    fn delete_removes() {
        let tmp = TempDir::new("delete");
        write_specialist(tmp.path(), "gone", SAMPLE).unwrap();
        assert!(read_specialist(tmp.path(), "gone").is_ok());
        delete_specialist(tmp.path(), "gone").unwrap();
        assert!(read_specialist(tmp.path(), "gone").is_err(), "file removed");
        assert!(list_specialists(tmp.path()).is_empty());
    }

    /// Deleting a nonexistent file is a no-op (Ok), not an error.
    #[test]
    fn delete_nonexistent_is_a_no_op() {
        let tmp = TempDir::new("delnoop");
        // Dir doesn't even exist yet.
        assert!(delete_specialist(tmp.path(), "never").is_ok());
        // Dir exists but file doesn't.
        write_specialist(tmp.path(), "other", SAMPLE).unwrap();
        assert!(delete_specialist(tmp.path(), "never").is_ok());
        assert!(read_specialist(tmp.path(), "other").is_ok(), "peer untouched");
    }

    /// Every operation REJECTS an unsafe name (path separators, `..`, empty)
    /// BEFORE touching the filesystem; the agents dir is never created for a
    /// rejected write.
    #[test]
    fn unsafe_name_is_rejected() {
        let tmp = TempDir::new("unsafe");
        for bad in ["../etc/passwd", "a/b", "a\\b", "..", "  ", ""] {
            assert!(read_specialist(tmp.path(), bad).is_err(), "read {bad:?}");
            assert!(write_specialist(tmp.path(), bad, SAMPLE).is_err(), "write {bad:?}");
            assert!(delete_specialist(tmp.path(), bad).is_err(), "delete {bad:?}");
        }
        // A rejected write must not have created the agents dir.
        assert!(
            !tmp.path().join(".claude").join("agents").exists(),
            "no dir created for rejected writes"
        );
    }
}
