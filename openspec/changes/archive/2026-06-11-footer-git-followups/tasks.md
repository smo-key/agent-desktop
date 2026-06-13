## 1. Footer git follows the panel selection when no agents are visible

- [x] 1.1 Add a `paneVisible` flag to `footerGitProjectId` (default true) that
      ignores the focused pane's project when the agent grid is hidden, falling
      back to the panel selection. Unit-tested in `footerView.test.ts`.
- [x] 1.2 Pass `topView.isGrid` as `paneVisible` from `AppFooter.svelte`.

## 2. Uncommitted-changes tooltip shows the file count

- [x] 2.1 Change the clickable uncommitted-files indicator's tooltip from
      "Click to review" to `uncommittedCountTooltip(git.modified)` in
      `GitInfo.svelte` (matches the inert pill + the other count pills).

## 3. Clicking a popover file opens it in the configured editor

- [x] 3.1 Make each file row in the commit popover clickable (keyboard-reachable),
      opening the file via `openInEditor` against the project folder. Keep the
      popover open on click so several files can be reviewed.
