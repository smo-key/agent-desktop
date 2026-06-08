# projects Specification

## Purpose

A project is a working folder with a name/color/icon, surfaced as a row in the
project pane and bound to agent sessions. The project pane lets the user filter
the fleet by project and act on a project via its row's right-click context menu;
the focused/selected project's git state is shown in the app footer rather than on
the rows. (Broader project-model requirements are defined by the `add-agent-desktop`
change and fold in when it archives; this spec currently captures the context-menu
git actions and the footer git indicator.)
## Requirements
### Requirement: Push And Pull A Project From Its Context Menu

A project's checkout SHALL be syncable with its git remote via **Push** and
**Pull** actions, exposed in TWO places: the project row's right-click context
menu in the project pane, AND the app footer's git indicators for the project the
footer is showing — the **ahead** (↑) indicator becomes a Push button and the
**behind** (↓) indicator a Pull button. Both surfaces invoke the SAME action
against the project's FOLDER (independent of any running agent session), shelling
out to `git push` / `git pull --ff-only` in that folder, run NON-INTERACTIVELY
(no credential / passphrase / host-key prompt) so a sync that would otherwise
prompt fails fast instead of hanging. Pull is fast-forward only, so a divergent
branch fails cleanly without ever leaving the worktree mid-merge.

On SUCCESS, the action shows a non-blocking toast naming the project and echoing
git's message. On FAILURE, the action opens an interactive terminal in the
project's folder that runs the failed git command, so the user sees git's full
output and can act on it (authenticate, resolve a conflict, retry); when no
terminal surface is available it falls back to a non-blocking failure toast
carrying git's own error. The action never blocks the UI and never throws.

#### Scenario: Push succeeds

- **WHEN** the user picks **Push** on a project whose folder is a git repo with a
  configured remote and local commits to send
- **THEN** the app runs `git push` in that folder
- **AND** shows a success toast naming the project and echoing git's message.

#### Scenario: Pull succeeds

- **WHEN** the user picks **Pull** on a project whose folder is a git repo with a
  configured upstream that has new commits
- **THEN** the app runs `git pull` in that folder, bringing the new commits in
- **AND** shows a success toast naming the project.

#### Scenario: Push or pull failure opens a terminal

- **WHEN** a Push or Pull cannot complete (no upstream, rejected non-fast-forward,
  a divergent branch on pull, or no network / a remote that would prompt) AND a
  terminal surface is available
- **THEN** the app opens an interactive terminal in the project's folder running
  the failed git command (`git push` / `git pull`)
- **AND** the action does not throw, and a failed pull leaves the worktree
  untouched (no mid-merge state).

#### Scenario: Push or pull fails

- **WHEN** a Push or Pull fails and no terminal surface is wired (or the project
  id is unknown)
- **THEN** the app shows a failure toast naming the project and carrying git's own
  error message
- **AND** the action does not throw.

#### Scenario: Push and pull are available from the footer

- **WHEN** the footer is showing a project's git state and the user clicks the
  ahead (↑) Push button or the behind (↓) Pull button
- **THEN** the app runs the same Push / Pull action against that project's folder
  (success toast; interactive terminal on failure).

#### Scenario: Project has no folder

- **WHEN** the user picks Push or Pull on a project that has no folder set
- **THEN** the app shows a toast warning there is no folder to sync
- **AND** does not invoke git.

### Requirement: Project Git State Is Shown In The Footer

A project's git state SHALL be surfaced in the app footer's left zone, before the
usage-limit bars, as a single always-visible indicator showing the current
branch, commits ahead/behind its upstream, and the count of modified files (each
shown even at zero). The indicator SHALL reflect the FOLDER git of the focused
pane's project; when no pane is focused (e.g. in the overview) it SHALL fall back
to the project currently selected in the project pane, and show no project git
when that selection is a non-project bucket (All agents / no project). The git
state SHALL NOT be rendered on the individual project-pane rows, which carry only
the project's icon, name, attention dot, and agent count.

#### Scenario: Footer shows the focused pane's project git

- **WHEN** a pane whose project folder is on branch `main`, 2 commits ahead with 3
  modified files, is focused
- **THEN** the footer's left zone shows that branch, ahead/behind, and modified
  count before the usage-limit bars.

#### Scenario: Footer falls back to the panel selection in the overview

- **WHEN** no pane is focused and the project pane has a concrete project selected
- **THEN** the footer shows that selected project's folder git.

#### Scenario: No project git for a non-project selection

- **WHEN** no pane is focused and the project pane's selection is the "All agents"
  or "no project" bucket
- **THEN** the footer shows no project git indicator content for a project.

#### Scenario: Project rows carry no git line

- **WHEN** the project pane renders its project rows
- **THEN** each row shows only the project icon, name, an attention dot when
  applicable, and the agent count — and no git status line.

