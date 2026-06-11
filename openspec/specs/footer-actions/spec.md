# footer-actions Specification

## Purpose
TBD - created by archiving change agent-session-ux-improvements. Update Purpose after archive.
## Requirements
### Requirement: Per-branch PR bubble in the footer

The footer SHALL show a per-branch PR bubble immediately to the RIGHT of the
edited-files (uncommitted-changes) count, SEPARATE from the open-PRs-awaiting-review
button (which is a distinct control). The bubble creates or manages the CURRENT
BRANCH's pull request into `main`:

- It SHALL be shown whenever the focused project is a GitHub repository (i.e. PR
  existence for the branch can be determined). When that cannot be determined (no
  GitHub remote, or `gh` unavailable/failing), the bubble SHALL be HIDDEN.
- WHEN a PR from the current branch into `main` EXISTS → the bubble SHALL show
  `PR #<number>` (with a pull-request icon) in a HIGHLIGHTED state, and clicking it
  SHALL open that PR on GitHub.
- WHEN NO such PR exists → the bubble SHALL show a GRAY `PR` (no number), and clicking
  it SHALL open a confirmation dialog asking whether to create a PR into `main`;
  confirming SHALL spawn an agent session (task) that creates the PR into `main` and
  auto-archives when it returns to the user, exactly as agent tasks run today.

#### Scenario: Existing PR shows its number and opens
- **WHEN** a PR from the current branch into `main` exists
- **THEN** the bubble shows `PR #<number>` in a highlighted state, and clicking it opens that PR on GitHub

#### Scenario: No PR shows a gray bubble that creates on click
- **WHEN** there is no PR from the current branch into `main` (a GitHub repo with no such PR)
- **THEN** the bubble shows a gray `PR`, and clicking it opens a create-PR confirmation; confirming spawns an agent session (task) that creates the PR into `main` and auto-archives

#### Scenario: Cancelling the confirm spawns nothing
- **WHEN** the create-PR confirmation dialog is shown and the user cancels
- **THEN** no agent session is spawned

#### Scenario: Hidden when PR existence cannot be determined
- **WHEN** PR existence cannot be determined (no GitHub remote / `gh` unavailable)
- **THEN** the per-branch PR bubble is hidden

### Requirement: Footer git popovers are scrollable, pinned, and dismissable

A footer git popover (push, uncommitted files, or open PRs) SHALL anchor to its
indicator, SHALL make its body SCROLLABLE when the content overflows, and SHALL pin its
PRIMARY ACTION button to the bottom so it stays visible while the body scrolls. The
popover SHALL close when the user clicks OUTSIDE it or presses Escape. Activating the
pinned PRIMARY ACTION SHALL ALSO close the popover immediately — without waiting for the
(possibly asynchronous) action to finish.

#### Scenario: Long list scrolls under a pinned action
- **WHEN** a footer popover's list is taller than the popover's maximum height
- **THEN** the list area scrolls while the bottom action button stays pinned and visible

#### Scenario: Clicking outside closes the popover
- **WHEN** a footer popover is open and the user clicks outside it
- **THEN** the popover closes

#### Scenario: Escape closes the popover
- **WHEN** a footer popover is open and the user presses Escape
- **THEN** the popover closes

#### Scenario: Activating the primary action closes the popover
- **WHEN** the user clicks a popover's pinned primary action (e.g. "Push now", "Commit now", or "Open PRs page")
- **THEN** the popover closes immediately (it does not stay open while the action runs)

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

### Requirement: Push indicator opens a push popover

Clicking the push (ahead) indicator SHALL open a popover LISTING the commits that a
push would send (the commits ahead of the upstream branch) with a pinned "Push now"
action that pushes the focused project's current branch to its remote. WHEN there is
nothing to push, the indicator SHALL be inert (or present an empty state) and SHALL
NOT push.

#### Scenario: Popover lists the commits to push
- **WHEN** the current branch is ahead of its upstream and the user clicks the push indicator
- **THEN** a popover lists the commits that the push would send

#### Scenario: Push now pushes the branch
- **WHEN** the push popover is open and the user clicks "Push now"
- **THEN** the focused project's current branch is pushed to its remote

#### Scenario: Nothing to push
- **WHEN** the current branch is not ahead of its upstream
- **THEN** clicking the push indicator does not push (it is inert or shows an empty state)

### Requirement: Open PRs awaiting review button

The footer SHALL show a button indicating the number of OPEN, NON-DRAFT pull requests
targeting `main` that are awaiting review. Draft PRs SHALL NOT be counted. WHEN one or
more such PRs exist, the button SHALL show a WARNING icon together with the count; WHEN
there are none, it SHALL show a CHECKMARK icon together with `0`. Clicking the button
SHALL open a popover LISTING the open PRs targeting `main`, with NON-DRAFT
(active) PRs shown FIRST and DRAFT PRs shown LAST; each PR row SHALL open that PR on
GitHub when clicked, and the popover SHALL have a pinned action that opens the
repository's pull-requests page on GitHub. The popover lists ALL open PRs (including
approved ones); only the BADGE count excludes drafts and approved PRs. WHEN the PR information cannot be determined (e.g. `gh`
is unavailable or fails), the button SHALL degrade gracefully — showing the
checkmark/`0` neutral state — without erroring.

#### Scenario: Non-draft PRs awaiting review show a warning and a count
- **WHEN** there are N (N > 0) open, non-draft PRs targeting `main` awaiting review
- **THEN** the button shows a warning icon and the number N

#### Scenario: Draft PRs are excluded from the count
- **WHEN** the only open PRs targeting `main` awaiting review are drafts
- **THEN** the button shows a checkmark icon and `0` (drafts are not counted)

#### Scenario: No open PRs shows a checkmark and zero
- **WHEN** there are no open, non-draft PRs targeting `main` awaiting review
- **THEN** the button shows a checkmark icon and `0`

#### Scenario: Popover lists PRs with drafts last
- **WHEN** the user clicks the open-PRs button
- **THEN** a popover lists the open PRs targeting `main`, with non-draft PRs first and draft PRs last (drafts are shown even though they are not counted)

#### Scenario: Clicking a PR opens it on GitHub
- **WHEN** the user clicks a PR row in the popover
- **THEN** that pull request is opened on GitHub

#### Scenario: Pinned action opens the pull-requests page
- **WHEN** the user clicks the popover's pinned action to open the PRs page
- **THEN** the repository's pull-requests page is opened on GitHub

#### Scenario: Detection unavailable degrades gracefully
- **WHEN** the open-PR information cannot be determined (e.g. `gh` is unavailable)
- **THEN** the button shows the neutral checkmark/`0` state and does not error

