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

Each PR row in the popover SHALL additionally show, best-effort:

- The PR AUTHOR'S avatar (the author's GitHub avatar image), with the author's
  DISPLAY NAME (or `@login`) shown on HOVER. WHEN the avatar image cannot be
  loaded, the row SHALL fall back to a textual glyph (the author's initial, or a
  bot glyph for bot authors). WHEN the author is unknown, the avatar SHALL be
  omitted (a neutral placeholder).
- WHEN the PR was LAST UPDATED, as a relative time (e.g. "2h ago"), with the exact
  timestamp shown on HOVER. WHEN the last-updated time is unavailable, it SHALL be
  omitted.
- A REVIEW-STATUS icon reflecting the PR's review decision, shown on EVERY row:
  APPROVED → a check, CHANGES_REQUESTED → an x, REVIEW_REQUIRED → a clock, and a
  NEUTRAL glyph when no review has been requested. Hovering the icon SHALL show a
  label describing the status.

These additions are BEST-EFFORT: a missing author, last-updated time, or avatar
image SHALL only hide that piece of the row and SHALL NOT error or hide the row.

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

#### Scenario: Each row shows the author avatar with a name on hover
- **WHEN** a PR row is shown for a PR with a known author
- **THEN** the row shows the author's avatar, and hovering it shows the author's display name (or `@login`)

#### Scenario: Author avatar falls back when the image cannot load
- **WHEN** a PR row's author avatar image cannot be loaded
- **THEN** the row shows a textual fallback glyph (the author's initial, or a bot glyph for a bot author) instead of a broken image

#### Scenario: Each row shows when the PR was last updated
- **WHEN** a PR row is shown for a PR whose last-updated time is known
- **THEN** the row shows a relative last-updated time (e.g. "2h ago"), with the exact timestamp on hover

#### Scenario: Each row shows a review-status icon
- **WHEN** a PR row is shown
- **THEN** the row shows a review-status icon — a check for approved, an x for changes requested, a clock for review required — with a label on hover

#### Scenario: A PR with no requested review shows a neutral status icon
- **WHEN** a PR row is shown for a PR that has no review decision yet (no review requested)
- **THEN** the row shows a neutral review-status glyph (not approved/changes/required)

#### Scenario: Enriched row context degrades gracefully
- **WHEN** a PR's author, last-updated time, or avatar image is unavailable
- **THEN** only that missing piece is omitted from the row and the row still renders and opens on GitHub

