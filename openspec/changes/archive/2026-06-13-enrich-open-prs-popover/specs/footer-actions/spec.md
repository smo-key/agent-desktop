# footer-actions delta

## MODIFIED Requirements

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
