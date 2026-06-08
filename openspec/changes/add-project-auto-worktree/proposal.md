## Why

Agents that work directly on a project's primary checkout mix experimental work,
stray edits, and side-changes into whatever branch is currently out, which
clutters the eventual PR and makes a clean "one change → one focused PR" workflow
hard. Giving each session its own isolated git worktree keeps every unit of agent
work on a disposable, dedicated branch so the primary checkout stays pristine and
each session maps cleanly to a single reviewable change.

## What Changes

- Add a per-project **`autoWorktree`** setting (boolean, default `false`),
  persisted on the project in `projects.json` and edited via a toggle in the
  project create/edit form.
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

- **Frontend model/store**: `src/lib/projects/projects.ts` (add `autoWorktree` to
  the `Project` interface + serialization), `src/lib/projects/projects.svelte.ts`
  (generic `update` already carries new fields).
- **UI**: `src/lib/projects/ProjectForm.svelte` (toggle); new worktree-management
  surface (list/open/prune) reached from the project panel/form.
- **Session launch**: `src/lib/launcher/newSession.ts` / `src/lib/launcher/plan.ts`
  (resolve the session cwd to a worktree path when `autoWorktree` is on),
  `src/lib/layout/workspace.svelte.ts` (carry the worktree association on the pane;
  trigger conditional cleanup on close).
- **Backend (Tauri/Rust)**: `src-tauri/src/lib.rs` + `src-tauri/src/git.rs` — new
  commands to create a worktree (+ `.gitignore` touch), check whether a worktree
  is clean vs. its branch, remove a worktree, and list a repo's worktrees. No git
  worktree support exists today.
- **Persistence**: `projects.json` gains an optional `autoWorktree` field
  (backward compatible; absent = `false`).
- **Dependencies**: none new — uses the system `git` binary already relied on by
  `git.rs`.
