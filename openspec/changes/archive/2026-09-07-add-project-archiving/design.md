# Design

## Model

- `Project.archived?: boolean` — additive and optional, like `logo`. `normalize`
  keeps it only when it is literally `true`, so old files and malformed values
  load as active and never round-trip a junk value.
- Pure helpers in `projects.ts`: `setProjectArchived(list, id, archived)` (an
  `updateProject` patch that deletes the key when clearing), `activeProjects(list)`,
  `archivedProjects(list)`.
- Store (`projects.svelte.ts`): `archive(id)` / `unarchive(id)` call the helper and
  `save()`; a derived `active` getter exposes the active list so consumers do not
  each re-filter.
- `projectRollup.filterOrder` skips archived projects itself, so every caller of
  the keyboard cycle is safe. `nextFilterAfterArchive(selected, id)` is the pure
  fallback-to-ALL rule the panel applies.

## Panel

- Rows and the rail iterate `projectCounts(rows, projects.active)`.
- A second `projectCounts(rows, projects.archived)` feeds the Archived section,
  rendered only when `showArchived` (session-local `$state`) is on; the toggle
  button sits directly below **New project** and is rendered only when
  `projects.archived.length > 0`.
- Context menus: active rows get **Archive project** (icon `archive`) between
  Pull and Delete; archived rows get **Unarchive** (icon `rotate-ccw`) and
  **Delete project**. Archived rows are not drag-reorderable.

## Consumers switched to the active list

`ProjectSelect.svelte` (launcher picker), `voice/spawn.ts` fallback project, and
the two git loops in `+page.svelte` (status poll + background fetch). Everything
that resolves a project *by id* (`projectForId` in roster avatars, task panels,
footer, launch paths) keeps reading the full list so bound agents still resolve.

## Worktrees removal

Delete `WorktreeDialog.svelte`, `worktreePanel.svelte.ts`,
`worktreePanel.svelte.test.ts`, the menu item and dialog mount in
`ProjectPanel.svelte`, the three `#[tauri::command]`s in `lib.rs`, and in
`git.rs` the `WorktreeCreated` / `WorktreeInfo` types, `WORKTREE_SEQ`,
`unique_branch_name`, `ensure_worktrees_ignored`, `worktree_create`,
`main_repo_dir`, `worktree_list`, `worktree_remove`, `remove_worktree`,
`branch_for_worktree`, `delete_branch`, and their seven tests (the shared
`TempRepo` / `run` / `bare_remote` helpers stay — the push/pull tests use them).
Prune any imports that become unused. The `project-worktrees` capability ends up
with no requirements; delete `openspec/specs/project-worktrees/spec.md` at
archive time.

## Coverage gate

`projects` is an enforced capability. Pure scenarios map to Vitest titles in
`projects.test.ts` / `projectRollup.test.ts`. The three DOM/route scenarios
(Show archived button, launcher picker, git-poll wiring) are added to the
`projects` MANUAL allowlist in `tools/check-scenario-coverage.mjs`.
