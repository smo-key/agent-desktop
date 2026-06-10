# git-branch-switching Specification

## Purpose
TBD - created by archiving change footer-branch-switcher. Update Purpose after archive.
## Requirements
### Requirement: Footer branch pill opens a branch picker

The footer's branch pill SHALL become an interactive button that opens a branch
picker for the footer's git project (the focused pane's project folder, or the
panel's current selection when no pane is focused). The branch pill rendered
outside the footer (e.g. the project pane) SHALL remain a read-only display with
no picker — the picker is wired only where the footer supplies a branch-pick
callback, mirroring how push/pull actions are wired only from the footer.

#### Scenario: Footer pill is actionable

- **WHEN** the footer shows a branch for a project that has a folder
- **THEN** the branch pill renders as a button that, when clicked, opens the
  branch picker anchored to the pill and opening upward (the footer is at the
  bottom of the window)

#### Scenario: Non-footer pill stays read-only

- **WHEN** `GitInfo` is rendered without a branch-pick callback (e.g. the project
  pane)
- **THEN** the branch pill renders as a non-interactive display element and no
  picker is available

#### Scenario: No branch to switch

- **WHEN** the footer's project has no folder, is not a git repository, or git
  cannot report a current branch
- **THEN** the branch pill is not actionable and clicking it does not open a
  picker

### Requirement: Picker lists local and remote branches

The picker SHALL list the project folder's local branches and remote-tracking
branches, obtained from a non-interactive git query. The branch the repository is
currently on SHALL be marked as selected. Local and remote branches SHALL be
visually distinguished (e.g. grouped into sections). Every listed remote entry
SHALL be a real `<remote>/<branch>` name: the remote's symbolic HEAD MUST be
excluded — including the bare remote name (e.g. `origin`) that git's short ref
form collapses `refs/remotes/origin/HEAD` into, which is not a checkout-able
branch. The query SHALL fail safely: a folder that is not a git repository or
that git cannot read yields an empty result rather than an error that breaks the
UI.

#### Scenario: Branches are listed with the current branch marked

- **WHEN** the picker opens for a repository on branch `main`
- **THEN** the picker lists the local branches with `main` marked as current, and
  lists remote-tracking branches in a separate section, each as a real
  `<remote>/<branch>` name — never the bare remote name `origin` (the remote's
  symbolic HEAD is excluded)

#### Scenario: Repository with no remote

- **WHEN** the picker opens for a repository that has no remote-tracking branches
- **THEN** the local branches are listed and no remote section is shown

#### Scenario: Detached HEAD

- **WHEN** the picker opens for a repository in a detached-HEAD state
- **THEN** the branches are still listed and no local branch is marked as current

### Requirement: Picker filters branches as the user types

The picker SHALL provide a text input that filters the listed local and remote
branches by substring as the user types, so a repository with many branches stays
navigable.

#### Scenario: Filtering narrows the list

- **WHEN** the user types `feat` into the picker's filter input
- **THEN** only branches whose name contains `feat` remain visible in both the
  local and remote sections

### Requirement: Switching to a local branch

Selecting an existing local branch SHALL check it out in the project folder via a
non-interactive git checkout. On success the picker closes, a confirmation toast
is shown, and the footer's folder git status is refreshed immediately so the new
branch (and ahead/behind/modified counts) appears without waiting for the next
poll. On failure git's own message SHALL be surfaced: an interactive terminal is
opened in the project folder running the failed git command when a terminal
surface is available, otherwise a failure toast carrying git's message is shown.
A dirty working tree that blocks the switch is not pre-checked — git's refusal is
surfaced like any other failure.

#### Scenario: Successful local switch

- **WHEN** the user selects a local branch other than the current one
- **THEN** the project folder is checked out to that branch, the picker closes, a
  confirmation toast appears, and the footer's git status refreshes to show the
  new branch

#### Scenario: Checkout blocked by uncommitted changes

- **WHEN** the user selects a branch but the working tree has changes that would be
  overwritten by the switch
- **THEN** git refuses the checkout and its error message is surfaced (interactive
  terminal in the folder when available, otherwise a failure toast), and the
  project stays on its current branch

#### Scenario: A branch name starting with a dash is treated as a ref not a flag

- **WHEN** a branch whose name begins with `-` (e.g. `-f`, which can exist as a
  ref such as `refs/remotes/origin/-f`) is selected
- **THEN** the checkout treats the name strictly as a ref to switch to, never as a
  command-line flag — so it can never force-discard the working tree — and git's
  error is surfaced if no such ref exists

### Requirement: Checking out a remote-tracking branch

Selecting a remote-tracking branch SHALL switch the project folder to a local
branch tracking it: when no local branch of that name exists git creates one set
to track the remote, and when a local branch of that name already exists git
simply switches to it. Success and failure are surfaced the same way as a local
switch (toast + immediate refresh on success; git's message via terminal/toast on
failure).

#### Scenario: Remote branch with no local counterpart

- **WHEN** the user selects remote-tracking branch `origin/feature-x` and no local
  `feature-x` exists
- **THEN** a local `feature-x` branch tracking `origin/feature-x` is created and
  checked out, and the footer refreshes

#### Scenario: Remote branch whose local branch already exists

- **WHEN** the user selects a remote-tracking branch whose corresponding local
  branch already exists
- **THEN** the project folder switches to the existing local branch without error

### Requirement: Creating a new branch

The picker SHALL offer an inline create-branch action that creates a new branch
off the current `HEAD` and switches to it (`git checkout -b`). The text in the
filter input MAY seed the new branch name. Success and failure are surfaced the
same way as a switch (toast + immediate refresh on success; git's message via
terminal/toast on failure, e.g. when the name is invalid or already exists).

#### Scenario: Create and switch to a new branch

- **WHEN** the user enters a new branch name and confirms the create action
- **THEN** a new branch is created off the current `HEAD`, the project folder
  switches to it, the picker closes, a confirmation toast appears, and the footer
  refreshes

#### Scenario: Create with an invalid or duplicate name

- **WHEN** the user attempts to create a branch with a name git rejects (invalid
  or already existing)
- **THEN** git's error message is surfaced and the project stays on its current
  branch

### Requirement: Guard against concurrent branch operations

A branch switch or create that is already in flight for a project folder SHALL
block another from starting against the same folder, using the same busy guard
shared with the project's push/pull actions. While an operation is in flight the
picker SHALL reflect the busy state and not trigger a second operation.

#### Scenario: Second operation is blocked while one is running

- **WHEN** a branch switch is already in flight for a project folder
- **THEN** triggering another switch or create for that same folder is ignored
  until the first completes

