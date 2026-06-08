## Context

Two pieces of project-scoped state are user-level today and should travel with
the repo:

- **Tasks** — `<app_data_dir>/tasks.json`, a single envelope
  `{ version, projects: { [projectId]: TaskDef[] } }`. Loaded once at startup by
  `ProjectTasksStore.load()`, saved whole on every mutation via `tasks_save`.
  The store is keyed by `projectId` and has **no knowledge of project paths**.
- **`autoWorktree`** — an optional boolean field on each `Project` record in
  `projects.json` (introduced by the in-review `add-project-auto-worktree`
  change), read on the session-launch path.

A precedent for project-folder storage already exists: `specialists.rs` reads
and writes `<project_path>/.claude/agents/*.md` with name-safety guards and
atomic tmp+rename writes. This change mirrors that module for a new
`.agent-desktop/` directory.

## Goals / Non-Goals

**Goals.** Relocate tasks and `autoWorktree` into `<project>/.agent-desktop/`
(committed), keyed by **project path**; migrate existing user-level data once and
then delete it; keep the committed file free of machine-local session state;
degrade gracefully when a project folder isn't writable.

**Non-Goals.** Relocating layout/recents/settings or the projects registry
itself. Preserving cross-restart terminal auto-restart (explicitly dropped).
Re-specifying worktree creation/cleanup behavior (owned by `project-worktrees`).

## Decisions

### D1 — Directory + file layout
`<project>/.agent-desktop/tasks.json` and `<project>/.agent-desktop/config.json`,
two separate files under one directory, committed (no `.gitignore` line is
added). Separate files so task churn never rewrites config and vice-versa.

- `tasks.json` envelope: `{ version, tasks: TaskDef[] }` — a **flat array** for a
  single project (no `projectId` keying; the file *is* the project's scope). This
  differs from the user-level envelope's `projects: { [id]: [...] }` map.
- `config.json` envelope: `{ version, autoWorktree?: boolean }` — additive; future
  per-project settings extend it. Absent file / absent field ⇒ `autoWorktree:
  false`.

### D2 — Rust commands keyed by project path
A new module (e.g. `project_store.rs`) mirrors `specialists.rs`: pure core over a
`project_path: &Path` (path resolution, atomic write, read-or-None), with thin
`#[tauri::command]` wrappers in `lib.rs`:

- `project_tasks_load(project_path) -> Option<String>`
- `project_tasks_save(project_path, json)`
- `project_config_load(project_path) -> Option<String>`
- `project_config_save(project_path, json)`

`.agent-desktop/` is created on first write. Reads of a missing dir/file return
`None` (not an error). Writes use sibling-tmp + rename for crash safety.

### D3 — Frontend store: per-project, path-aware
`ProjectTasksStore` keeps its in-memory `byProject` map (the panel still renders
all projects), but gains:

- A **projects-registry accessor** injected at construction/wiring (a
  `projectId → path` lookup), so the store never imports the projects store
  directly (keeps it Svelte/registry-decoupled, like `agentLauncher`).
- `load()` iterates known projects, calling `project_tasks_load(path)` per
  project and merging results into `byProject`.
- `save()` writes **only the affected project's** file via
  `project_tasks_save(path, serializeProjectTasks(defs))`. Each mutation knows its
  `projectId` (we already thread it or can derive it via `projectIdForTask`).
- A project with no resolvable/writable path is held in memory and its write is
  retried on the next `save()` for that project (D5).

### D4 — Sanitizing the committed file
`serializeProjectTasks(defs)` strips `wasRunning` and `lastCommand` before
writing. These were the inputs to selective auto-restart; with them gone,
`autoRestartIds()` finds nothing after a relaunch, so terminals come back as
stopped slots. `captureRunningAndSave()` (the quit-time flush) becomes a no-op
for restart purposes — we keep the call site but it no longer persists hints.
`closeOnComplete` and `cwd` are **definition** fields and remain. (The
in-flight, uncommitted `closeOnComplete` work in these files rides along — see
the change's process notes; it is a legitimate definition field.)

### D5 — Resilience (missing/read-only folder)
A failed `project_tasks_save` / `project_config_save` is caught (the commands
already return `Result`); the store logs and keeps the in-memory value, marking
that project **dirty**. The next successful-folder save flushes it. No
user-level fallback file. Loss is bounded to the session if the folder never
becomes writable — acceptable per the agreed resilience model.

### D6 — One-time migration, then delete
On first run after this change (detected by **absence of any
`.agent-desktop/tasks.json` for the known projects AND presence of the legacy
user-level `tasks.json`**), the store:

1. Reads the user-level `tasks.json` (and, if still relevant, legacy
   `terminals.json`) via the existing `tasks_load` / `terminals_load` commands.
2. For each project with tasks, resolves its path and writes
   `.agent-desktop/tasks.json` (sanitized).
3. Lifts each project's `autoWorktree` (read from the projects registry) into its
   `.agent-desktop/config.json`.
4. On success for **all** resolvable projects, deletes the user-level
   `tasks.json` (a new `tasks_clear`/delete command) and strips `autoWorktree`
   from every project in `projects.json` (a normal projects save after dropping
   the field). Projects whose folder couldn't be written are **skipped** and
   their user-level data is left for a later run.

Migration is idempotent: once `.agent-desktop/tasks.json` exists and the
user-level file is gone, it never runs again.

### D7 — `autoWorktree` read/write path
`autoWorktree` leaves the `Project` interface's persisted envelope. **As built**,
config access is **on-demand** (not cached in the task store) via a thin
`projectFolderConfig.ts` helper: `loadAutoWorktree(path)` wraps
`project_config_load` + `parseProjectConfig`, and `saveAutoWorktree(path, value)`
wraps `serializeProjectConfig` + `project_config_save`. The launch paths
(`newSession.ts`, `Launcher.svelte`) already `await` worktree creation, so an
extra `await loadAutoWorktree(path)` on that path is cheap and avoids a stale
cache. `ProjectForm` seeds the toggle (edit mode) from `loadAutoWorktree`; the
parent (`ProjectPanel`) writes via `saveAutoWorktree` on save — on **create** only
when the value is explicitly `true` (so a default-`false` config is never
materialized and a teammate-committed `true` is never clobbered on re-add). This
keeps the task store free of config concerns (it owns tasks only).

## Coupling with `project-worktrees` (in review)

`add-project-auto-worktree` is **in review, not archived**, so its
`project-worktrees` delta (which states `autoWorktree` is "stored in
`projects.json`") is not yet in the durable specs. This change therefore:

- Owns the relocation in the **new** `project-folder-storage` capability rather
  than authoring a conflicting `project-worktrees` delta.
- Leaves a reconciliation obligation: **when `add-project-auto-worktree`
  archives**, its "stored in `projects.json`" wording must be updated to
  `<project>/.agent-desktop/config.json`. If that change archives *before* this
  one lands, this change should instead carry a `## MODIFIED` delta against
  `project-worktrees`. Whoever archives second reconciles.

## Risks / Trade-offs

- **Committing session-ish data.** Even sanitized, `tasks.json` may carry
  absolute `cwd` paths a user pinned — those differ per machine. Accepted:
  `cwd` is an explicit user choice and usually `null`.
- **Dropped auto-restart** is a visible behavior regression; accepted to keep a
  single sanitized shared file and zero user-level storage.
- **Two-place data during partial migration** (some projects unwritable) is
  transient and self-heals on a later run.
