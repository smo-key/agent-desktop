## Why

Three small gaps in the footer's git surface, found in use:

1. Selecting a project in the project panel does NOT change the footer's git
   info when no agent panes are on screen (the overview). The active workspace
   always has a focused leaf, so the footer kept tracking that hidden pane's
   project instead of falling back to the panel selection — defeating the
   "track the selected project in the overview" intent.
2. The uncommitted-changes indicator's hover tooltip says only "Click to
   review", unlike the other indicators (behind/ahead) which show a count. It
   should show the number of uncommitted files, like its sibling pills.
3. The files listed in the uncommitted-changes popover are display-only. Clicking
   one should open that file in the user's configured editor (the open-with
   preferences), matching how transcript file links already behave.

## What Changes

- **Footer git tracks the panel selection whenever the agent grid is hidden.**
  `footerGitProjectId` gains a `paneVisible` flag; the footer passes the grid's
  visibility so the overview follows the project-panel selection (even with a
  pane still focused underneath), while the grid keeps tracking the focused pane.
- **Uncommitted-changes tooltip shows the file count.** The clickable indicator
  now uses the same count tooltip ("N uncommitted files") as the inert pill,
  instead of "Click to review".
- **Popover file rows are clickable.** Clicking a file in the uncommitted-changes
  popover opens it via the open-with preferences (resolved against the project
  folder, since git reports repo-relative paths). The popover stays open so the
  user can review several files and still reach "Commit now".

## Capabilities

- `projects` — footer git resolver now gated on pane visibility.
- `footer-actions` — uncommitted tooltip text + popover file-row open action.
