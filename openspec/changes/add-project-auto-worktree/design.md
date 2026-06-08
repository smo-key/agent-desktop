## Context

Sessions launch into a project's folder verbatim: `project.path` →
`LaunchRequest.folder` → `buildLaunchPlan().cwd` (pure, `src/lib/launcher/plan.ts`)
→ `workspace.launch()` → the pane's registry entry `cwd` → `pty_spawn`. Every
session for a project therefore shares one working tree and whatever branch is
checked out. There is **no** git-worktree support anywhere in the codebase today;
`src-tauri/src/git.rs` only shells out to read status (`run_git(dir, args)` helper,
`status_for_dir`).

We want a per-project opt-in so each session runs in its own throwaway worktree on
its own branch, keeping the primary checkout pristine and mapping one session to
one focused change/PR. Decisions (location, branch naming, cleanup, fallback) were
settled with the user up front; this doc records how they land in the architecture.

## Goals / Non-Goals

**Goals:**
- A persisted, per-project `autoWorktree` boolean, editable in the project form.
- When enabled, every new session for the project runs in a freshly-created
  worktree under `<repo>/.worktrees/`, on a unique branch off current `HEAD`.
- `.worktrees` auto-added to the repo's `.gitignore` on first use.
- Conditional cleanup on session close: remove the worktree **iff** it is clean
  (no uncommitted changes and no commits beyond its base); otherwise keep it.
- Graceful fallback: a worktree-creation failure never blocks the session — it
  launches in the project path with a non-blocking warning.
- Management UI to list / open / prune a project's accumulated worktrees.

**Non-Goals:**
- No worktree support for sessions of projects without `autoWorktree`.
- No automatic branch publishing, committing, or PR creation — only isolation.
- No multi-repo / submodule worktree handling beyond the project's own repo.
- No migration of existing sessions/panes into worktrees retroactively.

## Decisions

### 1. Where worktree creation hooks into the launch flow
Resolve the session's working directory **before** `buildLaunchPlan`, keeping
`plan.ts` pure. `startNewSession()` (and the launcher dialog's submit) become
async: if the chosen project has `autoWorktree`, `await` a new
`worktree_create(repoPath)` Tauri command, then pass the returned worktree path as
`folder`. On failure, warn (toast) and fall back to `project.path`.
*Alternative considered:* injecting worktree logic inside `buildLaunchPlan` —
rejected because it would make the pure, unit-tested builder do async I/O.

### 2. Worktree location & branch naming
- Path: `<repo>/.worktrees/<branch>` where branch = `session/<timestamp>-<id>`
  (timestamp + short random id for uniqueness, generated in Rust at creation so
  the path and branch are chosen atomically and can't collide).
- Branch is created off the repo's current `HEAD` commit (recorded as the
  worktree's **base SHA**).
- `.gitignore`: on create, if a `.worktrees` entry is absent from the repo-root
  `.gitignore`, append it (creating the file if needed). Idempotent.
*Alternative considered:* sibling `../<repo>-worktrees/` — rejected per user
choice (keep everything inside the repo).

### 3. "Clean" cleanup criterion
A worktree is removable on close **iff both**:
- `git -C <worktree> status --porcelain` is empty (no uncommitted changes), AND
- `git -C <worktree> rev-list <baseSha>..HEAD --count` is `0` (no commits added on
  the session branch beyond its base).

The **base SHA** is captured at creation and carried on the pane's registry entry
alongside the worktree path, so the check is deterministic even if the primary
checkout's `HEAD` has since moved. If removable, run `git worktree remove` and
delete the now-unused branch; otherwise leave both in place.
*Alternative considered:* comparing the session branch to the live parent `HEAD` —
rejected because the parent branch can advance independently and would produce
false "dirty" results.

### 4. Which lifecycle event triggers cleanup
Cleanup fires when a session's **pane is permanently removed** — `closeFocused()`
and `closeWorkspace()` in `workspace.svelte.ts`, where the registry entry is
pruned and its `TerminalPane` unmounts (killing the PTY). It does **not** fire on
`closeAgent()` (archive), because an archived session stays resumable and must keep
its worktree. Cleanup is best-effort and fire-and-forget: the frontend invokes
`worktree_remove_if_clean(worktreePath, baseSha)` and does not block teardown on
the result.
*Alternative considered:* cleaning up on archive — rejected: it would destroy the
working directory of a session the user can still resume.

### 5. Backend surface (new Tauri commands in `lib.rs`, logic in `git.rs`)
Reuse the existing `run_git(dir, args)` helper. Add:
- `worktree_create(repo_path) -> { path, branch, base }` — generate branch/path,
  ensure `.gitignore`, `git worktree add -b <branch> <path> HEAD`, return info.
  Errors propagate so the frontend can fall back.
- `worktree_remove_if_clean(worktree_path, base) -> { removed, reason }` — apply
  the criterion in Decision 3; remove + delete branch when clean.
- `worktree_list(repo_path) -> Vec<WorktreeInfo>` — worktrees under `.worktrees`
  with `{ path, branch, clean }` for the management UI.
- `worktree_remove(worktree_path, force) -> Result<(), String>` — explicit prune
  from the management UI (force removes even when dirty, on user confirmation).

### 6. Persistence & registry shape
- `autoWorktree` is persisted in the project's own folder config at
  `<project>/.agent-desktop/config.json` (the **project-folder-storage**
  capability — `project_config_load`/`project_config_save` Rust commands +
  `parseProjectConfig`/`serializeProjectConfig`), accessed from the frontend via
  `loadAutoWorktree`/`saveAutoWorktree` (`src/lib/projects/projectFolderConfig.ts`).
  It is **not** a `Project` record field and is stripped on parse from
  `projects.json`. Reads are defensive: absent/malformed/unreadable ⇒ `false`,
  never throwing. *Revised from the original plan to store it on the `Project`
  record (like `logo`): keeping per-folder settings with the folder travels with
  the repo and keeps the projects registry purely about identity.* The form emits a
  `ProjectDraft` (`Omit<Project,'id'> & { autoWorktree? }`); the panel splits the
  flag out, saves the record, then writes the flag to the folder config.
- The pane registry entry gains optional `worktreePath` and `worktreeBase` so
  close-time cleanup knows what to check/remove. Runtime-only association recorded
  at launch, mirroring how `projectId`/`cwd` are recorded verbatim (NOT serialized
  by `persistence.ts`, so the cleanup association is dropped across a restart; the
  management UI's prune is the escape hatch for any resulting orphans).

## Risks / Trade-offs

- **Async launch path** → `startNewSession` and launcher submit must become async;
  a slow `git worktree add` could briefly delay session start. → Keep creation a
  single fast git call; show the existing launch spinner; never block on cleanup.
- **Orphaned worktrees accumulate** (kept because dirty) → the management UI's
  list/prune is the escape hatch; `.worktrees` is gitignored so they never leak
  into commits.
- **Archived-then-restored sessions** keep their worktree (Decision 4); a worktree
  only disappears on permanent pane close → matches "never destroy unsaved work."
- **`.gitignore` already ignores `.worktrees` via a broader pattern** → append is
  guarded by a substring/line check so we don't add duplicates; harmless if the
  user later consolidates patterns.
- **Branch/dir name collision** under rapid launches → timestamp+random id chosen
  in Rust at creation makes collisions effectively impossible; `git worktree add`
  failing on collision still triggers the safe fallback.
- **Concurrent worktrees off a moving HEAD** → each records its own base SHA, so
  cleanup decisions stay independent and correct.
