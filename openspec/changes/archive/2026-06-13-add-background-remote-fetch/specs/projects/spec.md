## ADDED Requirements

### Requirement: Ahead/Behind Counts Are Refreshed Against The Remote

The app SHALL keep each tracked project's ahead/behind counts current against its
remote by running a periodic, best-effort background `git fetch`, so the footer's
and project pane's "commits to pull" (↓ behind) count reflects new remote commits
WITHOUT any manual fetch. The background fetch SHALL run always-on on a SLOW clock
(on the order of a few minutes), plus an initial fetch shortly after launch, and
SHALL be SEPARATE from the fast local status poll. It SHALL cover all tracked
project folders in parallel, run NON-INTERACTIVELY (so an offline or
credential-less folder fails fast rather than hanging), and be READ-ONLY — it
updates only remote-tracking refs and never modifies the worktree. The fast local
status probe SHALL remain unchanged (it computes ahead/behind from local refs and
does not itself fetch); it reads the freshly-advanced refs on its next poll.

#### Scenario: New remote commit becomes visible without a manual fetch

- **WHEN** a tracked project's branch tracks an upstream and a new commit lands on
  that upstream branch
- **THEN** within one background-fetch interval the app fetches the project's
  remote-tracking refs and the footer's (and project pane's) behind (↓) count for
  that project reflects the new commit, with the user never running `git fetch`.

#### Scenario: Background fetch is parallel and best-effort

- **WHEN** the background fetch runs over the tracked project folders
- **THEN** it fetches them in parallel, and a folder that cannot fetch (no remote,
  offline, or missing credentials) fails fast and is skipped without blocking the
  other folders or surfacing an error to the user.

#### Scenario: Fetch never alters the working tree

- **WHEN** the background fetch runs for a project that has uncommitted changes or
  in-progress work
- **THEN** it only updates that repo's remote-tracking refs (a read-only fetch) and
  does NOT modify, merge, rebase, or check out anything in the worktree.

#### Scenario: The fast status probe stays local-only

- **WHEN** the per-pane / per-project git status is polled on its fast clock
- **THEN** that probe computes ahead/behind from LOCAL refs only and does not
  itself fetch — the separate slow background fetch is what advances the
  remote-tracking refs it reads.

#### Scenario: Initial fetch shortly after launch

- **WHEN** the app starts with one or more tracked projects
- **THEN** an initial background fetch runs shortly after launch (not only after a
  full interval) so the counts become accurate without waiting the full cadence.
