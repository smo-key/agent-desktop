# Tasks

- [ ] 1.1 Model: add `archived?: boolean` to `Project`, normalize it on parse,
      add `setProjectArchived` / `activeProjects` / `archivedProjects`, with
      unit tests named after the spec scenarios.
- [ ] 1.2 Store: add `archive(id)` / `unarchive(id)` and the derived
      `active` / `archived` getters to `ProjectsStore`.
- [ ] 1.3 Rollup: `filterOrder` skips archived projects; add
      `nextFilterAfterArchive`; unit tests for the keyboard-cycle and
      bound-agent scenarios.
- [ ] 1.4 Panel: **Archive project** on active rows, the **Show archived (N)** /
      **Hide archived** toggle below **New project**, the muted Archived
      section with **Unarchive** / **Delete project** menus, filter fallback.
- [ ] 1.5 Consumers: launcher `ProjectSelect`, `voice/spawn.ts` fallback, and
      the `+page.svelte` git status poll + background fetch use the active list.
- [ ] 2.1 Remove the Worktrees… menu item, `WorktreeDialog.svelte`,
      `worktreePanel.svelte.ts` and its test.
- [ ] 2.2 Remove the `worktree_create` / `worktree_list` / `worktree_remove`
      commands from `lib.rs` and the worktree helpers, types, and tests from
      `git.rs`; fix unused imports; `cargo test` green.
- [ ] 3.1 Add the DOM/route scenarios to the `projects` MANUAL allowlist in
      `tools/check-scenario-coverage.mjs`; `yarn coverage` green.
- [ ] 3.2 `yarn check`, `yarn test`, and `cargo test` green.
