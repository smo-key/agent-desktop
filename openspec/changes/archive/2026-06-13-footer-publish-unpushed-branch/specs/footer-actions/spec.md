# footer-actions delta

## MODIFIED Requirements

### Requirement: Push indicator opens a push popover

The push (↑) indicator SHALL ALWAYS be a BUTTON that opens a popover whenever a
push handler is available (the footer has a real project folder bound) — in ALL
cases, so the user takes the secondary "Push now" action inside the popover rather
than the pill pushing on click. The popover LISTS the commits that a push would
send and pins a "Push now" action that pushes the focused project's current branch
to its remote. The commits listed (and counted) are those AGAINST THE UPSTREAM when
the branch is published, else (an UNPUBLISHED branch with a remote) the commits not
yet on ANY remote — i.e. what publishing the branch would upload. WHEN there are no
such commits, the popover presents an empty state, but the pinned action remains so
the user can still publish an unpublished branch (or run a no-op push on a synced
branch).

The indicator SHALL read in a HIGHLIGHTED state whenever there is something to do —
there are commits to push, OR the branch is UNPUBLISHED (has no upstream), even at
zero commits (since pushing PUBLISHES the branch). It SHALL read in a NEUTRAL empty
state (mirroring the open-PRs zero-state pill) only when the branch is published AND
fully in sync (zero commits to push), or when the count is unknown (e.g. there is no
remote to push to). The indicator SHALL be DISABLED only while a push/pull for the
project is in flight; it SHALL NOT be inert in any other state.

WHEN the project's repository is hosted on GitHub (its web URL is resolvable), each
listed commit row SHALL be a clickable link that opens that commit's diff view on
GitHub (`<repo url>/commit/<hash>`) in the default browser and dismisses the popover.
WHEN the repository is not on GitHub (or its web URL cannot be resolved), the commit
rows SHALL remain inert display rows.

#### Scenario: Clicking the indicator always opens the popover

- **WHEN** the footer has a project folder bound and the user clicks the push (↑) indicator
- **THEN** the push popover opens (in every case, regardless of how many commits there are to push)

#### Scenario: Popover lists the commits to push

- **WHEN** the current branch is ahead of its upstream and the user clicks the push indicator
- **THEN** the popover lists the commits that the push would send

#### Scenario: Push now pushes the branch

- **WHEN** the push popover is open and the user clicks "Push now"
- **THEN** the focused project's current branch is pushed to its remote

#### Scenario: Unpublished branch is highlighted and publishable

- **WHEN** the current branch has no upstream (was never pushed) and a remote exists
- **THEN** the push indicator is highlighted (even at zero commits), and the popover lists the commits not yet on any remote with a "Push now" action that publishes the branch

#### Scenario: Synced branch shows a neutral empty state but still opens

- **WHEN** the current branch is published and fully in sync (nothing to push)
- **THEN** the push indicator shows the neutral empty state (mirroring the open-PRs zero pill), and clicking it still opens the popover (which presents an empty state)

#### Scenario: Indicator is disabled only while syncing

- **WHEN** a push or pull for the project is in flight
- **THEN** the push indicator is disabled until the sync completes; in every other state it is an enabled button

#### Scenario: Clicking a commit opens its diff on GitHub

- **WHEN** the push popover is open for a GitHub-hosted repository and the user clicks one of the listed commits
- **THEN** that commit's diff view opens on GitHub (`<repo url>/commit/<hash>`) in the default browser and the popover is dismissed

#### Scenario: Commit rows are inert off GitHub

- **WHEN** the push popover is open for a repository whose GitHub web URL cannot be resolved (not on GitHub, or `gh` is unavailable)
- **THEN** the listed commit rows are plain display rows and clicking them does nothing
