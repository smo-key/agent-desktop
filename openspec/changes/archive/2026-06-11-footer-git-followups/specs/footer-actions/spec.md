## MODIFIED Requirements

### Requirement: Uncommitted-files indicator opens a commit popover

Clicking the uncommitted-files indicator when there are uncommitted changes SHALL
open a popover LISTING the uncommitted file paths with a pinned "Commit now" action;
the action SHALL spawn an agent session (task) that commits the changes and
auto-archives when it returns to the user. Each file row in the popover SHALL be
clickable (and keyboard-activatable); clicking a file SHALL open it in the user's
configured editor (the open-with preferences), resolved against the project folder
since git reports repo-relative paths. Opening a file SHALL leave the popover OPEN
(so several files can be reviewed before committing). WHEN there are no uncommitted
changes, the indicator SHALL be inert (clicking does nothing).

#### Scenario: Popover lists the uncommitted files
- **WHEN** there are uncommitted changes and the user clicks the uncommitted-files indicator
- **THEN** a popover lists the uncommitted file paths

#### Scenario: Clicking a file opens it in the configured editor
- **WHEN** the commit popover is open and the user clicks (or keyboard-activates) a file row
- **THEN** that file is opened in the user's configured editor (the open-with preferences), resolved against the project folder
- **AND** the popover stays open

#### Scenario: Commit now spawns the commit task
- **WHEN** the commit popover is open and the user clicks "Commit now"
- **THEN** an agent session (task) is spawned that commits the changes and auto-archives when it returns to the user

#### Scenario: No changes means an inert indicator
- **WHEN** there are no uncommitted changes
- **THEN** clicking the uncommitted-files indicator does nothing (no popover)

### Requirement: The uncommitted-files indicator tooltip shows the file count

The uncommitted-files indicator tooltip SHALL, when the indicator is clickable (there
are uncommitted changes), show the COUNT of uncommitted files (e.g. "3 uncommitted
files") — consistent with the behind/ahead indicators' count tooltips. It SHALL NOT
read merely "Click to review", and SHALL NOT enumerate the individual file paths. The
file list appears in the click popover.

#### Scenario: Hover shows the uncommitted file count
- **WHEN** there are uncommitted changes and the user hovers the uncommitted-files indicator
- **THEN** the tooltip shows the count of uncommitted files (it does not enumerate the files)

#### Scenario: File list lives in the popover, not the tooltip
- **WHEN** the user hovers the uncommitted-files indicator
- **THEN** the tooltip does not list individual file paths (the list is shown on click, in the popover)
