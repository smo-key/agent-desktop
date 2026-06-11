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

### Requirement: Commit action on the uncommitted-files indicator

Clicking the uncommitted-files indicator when there are uncommitted changes SHALL
open a confirmation dialog; confirming SHALL spawn an agent session (task) that
commits the changes and auto-archives when it returns to the user. WHEN there are
no uncommitted changes, the indicator SHALL be inert (clicking does nothing).

#### Scenario: Commit pending changes
- **WHEN** there are uncommitted changes and the user clicks the uncommitted-files indicator and confirms
- **THEN** an agent session (task) is spawned that commits the changes and auto-archives when it returns to the user

#### Scenario: No changes means an inert indicator
- **WHEN** there are no uncommitted changes
- **THEN** clicking the uncommitted-files indicator does nothing (no dialog)

#### Scenario: Cancelling the confirm spawns nothing
- **WHEN** the commit confirmation dialog is shown and the user cancels
- **THEN** no agent session is spawned

### Requirement: The uncommitted-files indicator lists files on hover

Hovering the uncommitted-files indicator SHALL show a tooltip listing the
uncommitted file paths, capped at the FIRST 10, with an indication when more files
exist beyond the first 10. WHEN there are no uncommitted changes, no file list is
shown on hover.

#### Scenario: Hover shows up to ten changed files
- **WHEN** there are uncommitted changes and the user hovers the uncommitted-files indicator
- **THEN** a tooltip lists the changed file paths, at most the first 10

#### Scenario: More than ten files indicates the overflow
- **WHEN** there are more than 10 uncommitted files and the user hovers the indicator
- **THEN** the tooltip lists the first 10 and indicates that more files exist

#### Scenario: No changes shows no file list
- **WHEN** there are no uncommitted changes
- **THEN** hovering the indicator shows no file list

### Requirement: Open PRs awaiting review button

The footer SHALL show a button indicating the number of OPEN pull requests targeting
`main` that are awaiting review. WHEN one or more such PRs exist, the button SHALL
show a WARNING icon together with the count; WHEN there are none, it SHALL show a
CHECKMARK icon together with `0`. Clicking the button SHALL open the repository's
pull-requests page on GitHub. WHEN the PR count cannot be determined (e.g. `gh` is
unavailable or fails), the button SHALL degrade gracefully — showing the checkmark/`0`
neutral state — without erroring.

#### Scenario: Open PRs awaiting review show a warning and a count
- **WHEN** there are N (N > 0) open PRs targeting `main` awaiting review
- **THEN** the button shows a warning icon and the number N

#### Scenario: No open PRs shows a checkmark and zero
- **WHEN** there are no open PRs targeting `main` awaiting review
- **THEN** the button shows a checkmark icon and `0`

#### Scenario: Clicking opens the GitHub pull-requests page
- **WHEN** the user clicks the open-PRs button
- **THEN** the repository's pull-requests page is opened on GitHub

#### Scenario: Detection unavailable degrades gracefully
- **WHEN** the open-PR count cannot be determined (e.g. `gh` is unavailable)
- **THEN** the button shows the neutral checkmark/`0` state and does not error
