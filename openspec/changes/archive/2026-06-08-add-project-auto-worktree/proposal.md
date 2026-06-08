## Why

Agents that work directly on a project's primary checkout mix experimental work,
stray edits, and side-changes into whatever branch is currently out, which
clutters the eventual PR and makes a clean "one change → one focused PR" workflow
hard. Giving each session its own isolated git worktree keeps every unit of agent
work on a disposable, dedicated branch so the primary checkout stays pristine and
each session maps cleanly to a single reviewable change.

## What Changes

- Add a per-project **`autoWorktree`** setting (boolean, default `false`),
  persisted in the project's folder config at `<project>/.agent-desktop/config.json`
  (the project-folder-storage capability) — not on the `Project` record — and
  edited via a toggle in the project create/edit form.
- When a project with `autoWorktree` enabled launches a session, the app
  **auto-creates a fresh git worktree** at `<repo>/.worktrees/session/<timestamp>-<id>`
  on a new unique branch off the repo's current `HEAD`, and runs the session in
  that worktree instead of the repo root.
- On **first** worktree creation for a repo, ensure `.worktrees` is present in
  the repo's `.gitignore` (append it if missing).
- On **session close**, auto-remove that session's worktree **only if it has no
  changes** relative to its branch (clean tree, no commits ahead). Otherwise keep
  the worktree and its branch so unsaved/uncommitted work is never destroyed.
- If worktree creation **fails** (folder isn't a git repo, git error, etc.), fall
  back to launching the session in the project's normal path and surface a
  non-blocking warning — the session always starts.
- Add **worktree management UI** so a project's accumulated worktrees (e.g. those
  kept because they had changes) can be listed, opened, and pruned without
  dropping to a terminal.

## Capabilities

### New Capabilities
- `project-worktrees`: per-project auto-worktree setting; automatic worktree
  creation on session launch (location, branch naming, `.gitignore` handling);
  conditional cleanup on session close; failure fallback; and management of a
  project's existing worktrees (list / open / prune).

### Modified Capabilities
<!-- None — no existing capability spec covers project settings or session launch cwd. -->

## Impact

- **Frontend model/store**: `src/lib/projects/projects.ts` (a `ProjectDraft` type
  carrying `autoWorktree` alongside the record fields; `autoWorktree` is stripped
  from the persisted `Project`), `src/lib/projects/projectFolderConfig.ts`
  (`loadAutoWorktree`/`saveAutoWorktree` over the project-folder-storage commands).
- **UI**: `src/lib/projects/ProjectForm.svelte` (toggle, seeded from folder config
  in edit mode), `src/lib/projects/ProjectPanel.svelte` (routes the draft's flag to
  the folder config); new worktree-management surface (list/open/prune) reached
  from the project panel/form.
- **Session launch**: `src/lib/launcher/newSession.ts` / `src/lib/launcher/plan.ts`
  (resolve the session cwd to a worktree path when `autoWorktree` is on),
  `src/lib/layout/workspace.svelte.ts` (carry the worktree association on the pane;
  trigger conditional cleanup on close).
- **Backend (Tauri/Rust)**: `src-tauri/src/lib.rs` + `src-tauri/src/git.rs` — new
  commands to create a worktree (+ `.gitignore` touch), check whether a worktree
  is clean vs. its branch, remove a worktree, and list a repo's worktrees. No git
  worktree support exists today.
- **Persistence**: `autoWorktree` lives in `<project>/.agent-desktop/config.json`
  (project-folder-storage); `projects.json` is unchanged. Absent/malformed ⇒ `false`.
- **Dependencies**: none new — uses the system `git` binary already relied on by
  `git.rs`.
