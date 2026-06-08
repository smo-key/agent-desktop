# Tasks

- [x] 1.1 Add a pure `footerGitProjectId(focusedProjectId, panelSelection)`
  resolver in `footerView.ts` (focused pane's project, else a concrete panel
  selection, else null), with unit tests in `footerView.test.ts`.
- [x] 1.2 Wire `AppFooter.svelte` to show an always-visible folder-git indicator
  (`projectGit.forPath`) in the left zone before the limit bars, and remove the
  previous right-side statusline git indicator.
- [x] 1.3 Remove the per-project git status line from `ProjectPanel.svelte` rows
  and simplify the row back to a single inline line; drop the now-unused
  `GitInfo` / `projectGit` imports and the stacked-row CSS.
- [x] 1.4 Verify: `npm run check` clean and full `vitest run` green.
