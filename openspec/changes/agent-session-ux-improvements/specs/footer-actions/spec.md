## ADDED Requirements

### Requirement: PR button in the footer

The footer SHALL show a PR button immediately to the RIGHT of the edited-files
(uncommitted-changes) count. Its behavior SHALL depend on whether a pull request
from the focused project's current branch into `main` already exists:

- WHEN a PR exists → clicking the button SHALL open that PR.
- WHEN no PR exists → clicking SHALL open a confirmation dialog asking whether to
  create a PR into `main`; confirming SHALL spawn an agent session (task) that
  creates the PR into `main` and auto-archives when it returns to the user, exactly
  as agent tasks run today.

The button SHALL be DISABLED when the current branch is the base branch (`main`),
or when there is no git branch / project to act on. When PR existence cannot be
determined (e.g. the `gh` lookup is unavailable or fails), the button SHALL fall
back to the create-confirm path rather than silently doing nothing.

#### Scenario: Create a PR from a feature branch
- **WHEN** the focused project is on a feature branch with no PR into `main`, and the user clicks the PR button and confirms
- **THEN** an agent session (task) is spawned that creates a PR into `main` and auto-archives when it returns to the user

#### Scenario: Open an existing PR
- **WHEN** a PR from the current branch into `main` already exists and the user clicks the PR button
- **THEN** that PR is opened

#### Scenario: Disabled on the base branch
- **WHEN** the focused project's current branch is `main` (the base branch)
- **THEN** the PR button is disabled (there is nothing to PR into itself)

#### Scenario: Cancelling the confirm spawns nothing
- **WHEN** the create-PR confirmation dialog is shown and the user cancels
- **THEN** no agent session is spawned

#### Scenario: Detection unavailable falls back to create-confirm
- **WHEN** PR existence cannot be determined for the current branch
- **THEN** clicking the button opens the create-PR confirmation rather than doing nothing

### Requirement: Footer git popovers are scrollable, pinned, and dismissable

A footer git popover (push, uncommitted files, or open PRs) SHALL anchor to its
indicator, SHALL make its body SCROLLABLE when the content overflows, and SHALL pin its
PRIMARY ACTION button to the bottom so it stays visible while the body scrolls. The
popover SHALL close when the user clicks OUTSIDE it or presses Escape.

#### Scenario: Long list scrolls under a pinned action
- **WHEN** a footer popover's list is taller than the popover's maximum height
- **THEN** the list area scrolls while the bottom action button stays pinned and visible

#### Scenario: Clicking outside closes the popover
- **WHEN** a footer popover is open and the user clicks outside it
- **THEN** the popover closes

#### Scenario: Escape closes the popover
- **WHEN** a footer popover is open and the user presses Escape
- **THEN** the popover closes

### Requirement: Uncommitted-files indicator opens a commit popover

Clicking the uncommitted-files indicator when there are uncommitted changes SHALL
open a popover LISTING the uncommitted file paths with a pinned "Commit now" action;
the action SHALL spawn an agent session (task) that commits the changes and
auto-archives when it returns to the user. WHEN there are no uncommitted changes, the
indicator SHALL be inert (clicking does nothing).

#### Scenario: Popover lists the uncommitted files
- **WHEN** there are uncommitted changes and the user clicks the uncommitted-files indicator
- **THEN** a popover lists the uncommitted file paths

#### Scenario: Commit now spawns the commit task
- **WHEN** the commit popover is open and the user clicks "Commit now"
- **THEN** an agent session (task) is spawned that commits the changes and auto-archives when it returns to the user

#### Scenario: No changes means an inert indicator
- **WHEN** there are no uncommitted changes
- **THEN** clicking the uncommitted-files indicator does nothing (no popover)

### Requirement: The uncommitted-files indicator tooltip shows only the count

Hovering the uncommitted-files indicator SHALL show a tooltip stating only the NUMBER
of uncommitted files — it SHALL NOT enumerate the file paths. The file list SHALL
appear in the click popover instead.

#### Scenario: Hover shows the count
- **WHEN** there are N uncommitted changes and the user hovers the uncommitted-files indicator
- **THEN** the tooltip states the count N and does not enumerate the individual files

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
SHALL open a popover LISTING the awaiting-review PRs targeting `main`, with NON-DRAFT
PRs shown FIRST and DRAFT PRs shown LAST; each PR row SHALL open that PR on GitHub when
clicked, and the popover SHALL have a pinned action that opens the repository's
pull-requests page on GitHub. WHEN the PR information cannot be determined (e.g. `gh`
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
- **THEN** a popover lists the awaiting-review PRs targeting `main`, with non-draft PRs first and draft PRs last (drafts are shown even though they are not counted)

#### Scenario: Clicking a PR opens it on GitHub
- **WHEN** the user clicks a PR row in the popover
- **THEN** that pull request is opened on GitHub

#### Scenario: Pinned action opens the pull-requests page
- **WHEN** the user clicks the popover's pinned action to open the PRs page
- **THEN** the repository's pull-requests page is opened on GitHub

#### Scenario: Detection unavailable degrades gracefully
- **WHEN** the open-PR information cannot be determined (e.g. `gh` is unavailable)
- **THEN** the button shows the neutral checkmark/`0` state and does not error
