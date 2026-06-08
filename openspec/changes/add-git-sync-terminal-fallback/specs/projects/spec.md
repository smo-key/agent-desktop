# projects (delta)

## MODIFIED Requirements

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
