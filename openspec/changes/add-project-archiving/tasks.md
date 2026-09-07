# Tasks

- [x] 1.1 Model: add `archived?: boolean` to `Project`, normalize it on parse,
      add `setProjectArchived` / `activeProjects` / `archivedProjects`, with
      unit tests named after the spec scenarios.
- [x] 1.2 Store: add `archive(id)` / `unarchive(id)` and the derived
      `active` / `archived` getters to `ProjectsStore`.
- [x] 1.3 Rollup: `filterOrder` skips archived projects; add
      `nextFilterAfterArchive`; unit tests for the keyboard-cycle and
      bound-agent scenarios.
- [x] 1.4 Panel: **Archive project** on active rows, the **Show archived (N)** /
      **Hide archived** toggle below **New project**, the muted Archived
      section with **Unarchive** / **Delete project** menus, filter fallback.
- [x] 1.5 Consumers: launcher `ProjectSelect`, `voice/spawn.ts` fallback, and
      the `+page.svelte` git status poll + background fetch use the active list.
- [x] 2.1 Remove the Worktrees… menu item, `WorktreeDialog.svelte`,
      `worktreePanel.svelte.ts` and its test.
- [x] 2.2 Remove the `worktree_create` / `worktree_list` / `worktree_remove`
      commands from `lib.rs` and the worktree helpers, types, and tests from
      `git.rs`; fix unused imports; `cargo test` green.
- [x] 3.1 Add the DOM/route scenarios to the `projects` MANUAL allowlist in
      `tools/check-scenario-coverage.mjs`; `yarn coverage` green.
- [x] 3.2 `yarn check`, `yarn test`, and `cargo test` green.
- [x] 4.1 Review follow-ups: keep a selected archived project visible (auto-expand /
      fall back to All agents on hide), reset the toggle when nothing is archived,
      exclude archived projects from ⌘N / voice direct launch and the footer folder
      git, and chain `projects_save` calls so rapid toggles persist in order (with
      a store test).
