## Why

Project **tasks** (the user-created terminal/agent slots) and the per-project
**auto-worktree** setting currently live at the *user level*, in the app-data
directory: tasks in `<app_data_dir>/tasks.json` keyed by `projectId`, and
`autoWorktree` as a field on each project in `projects.json`. That couples
project-scoped configuration to a single machine's app-data and to opaque
internal project ids. Moving this data **into the project folder** (committed,
under `<project>/.agent-desktop/`) makes it travel with the repo: tasks and the
worktree default are shared across a team and portable across machines, living
next to the project they describe rather than in a hidden per-user blob.

## What Changes

- Introduce a per-project on-disk store under **`<project>/.agent-desktop/`**,
  committed/shared (no `.gitignore` entry), with two files:
  - **`tasks.json`** — the project's task definitions (the relocated, per-project
    half of today's user-level `tasks.json`).
  - **`config.json`** — per-project configuration, initially the **`autoWorktree`**
    boolean. `autoWorktree` no longer lives in `projects.json`.
- **Tasks persistence keyed by project path.** New Rust commands read/write a
  given project's `.agent-desktop/tasks.json` (and `config.json`) by **project
  path**, mirroring the atomic tmp+rename + name-safety pattern already used by
  `specialists.rs`. The frontend tasks store gains access to the projects
  registry so it can resolve `projectId → path`, and loads/saves **per project**
  instead of one global file.
- **Sanitized committed file.** Machine-local restore hints (`wasRunning`,
  `lastCommand`) are **excluded** when writing `.agent-desktop/tasks.json`, so a
  shared file never carries one developer's transient session state.
  Consequence: **selective auto-restart of previously-running terminals across an
  app quit/relaunch is dropped** — terminals restore as stopped slots.
- **One-time migration, then destructive cleanup.** On first run after this
  change, existing user-level data is migrated into each project's folder
  (tasks from `<app_data_dir>/tasks.json`; `autoWorktree` from `projects.json`),
  then the old user-level `tasks.json` is removed and the `autoWorktree` field is
  stripped from `projects.json`. The legacy `terminals.json` fallback path is
  retired by the same token. Migration is best-effort per project: a project
  whose folder can't be written is skipped (its user-level data is left intact
  for a later retry).
- **Resilience.** When a project's folder is missing, read-only, or not yet on
  disk, tasks/config operate **in memory** and the write is retried on the next
  save once the folder is writable. No user-level fallback file is reintroduced.

## Impact

- **Affected specs:** new capability `project-folder-storage`; `project-tasks`
  (persistence location modified).
- **Affected code:** `src-tauri/src/lib.rs` (+ a new project-folder store module
  mirroring `specialists.rs`), `src/lib/tasks/projectTasks.ts` &
  `projectTasks.svelte.ts` (per-project load/save, sanitize, registry
  injection), `src/lib/projects/projects.ts` & `ProjectForm.svelte` (read/write
  `autoWorktree` via the project-folder config, drop it from the registry
  envelope), and the session-launch path that reads `autoWorktree`.
- **Coupling to note:** the in-review change `add-project-auto-worktree`
  (capability `project-worktrees`) introduced `autoWorktree` and specs it as
  stored in `projects.json`. That capability is **not yet archived**, so this
  change does not author a `project-worktrees` delta; the relocation is owned by
  `project-folder-storage`. When `add-project-auto-worktree` archives, its
  "stored in `projects.json`" wording must be reconciled to point at
  `.agent-desktop/config.json` (see `design.md`).
- **Out of scope:** `layout.json`, `recents.json`, `settings.json`, the projects
  registry file itself, and `.claude/agents/` specialists — all stay where they
  are.
