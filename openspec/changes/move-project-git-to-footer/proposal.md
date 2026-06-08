# Move project git state out of the project pane into the footer

## Why

Each project row in the project pane carried a full git status line (branch,
ahead/behind, modified-file count), which crowded the rows and duplicated the
footer's existing git slot. The git state reads better in one consistent place.

## What changes

- Remove the per-project git status line from each project pane row; rows return
  to a single compact line (icon · name · attention · count).
- Show one always-visible **folder git** indicator in the footer's **left** zone,
  before the usage-limit bars: branch + ahead/behind + modified count for the
  focused pane's project, falling back to the project-panel selection so it stays
  meaningful in the overview (where no pane is focused).
- Drop the footer's previous right-side (focused-pane statusline) git indicator,
  so there is a single git display.

## Impact

- Affected spec: `projects` (where project git state is surfaced).
- Affected code: `ProjectPanel.svelte`, `AppFooter.svelte`, `footerView.ts`
  (new pure `footerGitProjectId` resolver). The `projectGit` folder-git store and
  its route poll are unchanged — the footer now consumes them.
