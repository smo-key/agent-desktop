## ADDED Requirements

### Requirement: Push And Pull A Project From Its Context Menu

A project row's right-click context menu in the project pane SHALL offer **Push**
and **Pull** actions that sync the project's checkout with its git remote. Both
act on the project's FOLDER (independent of any running agent session), shelling
out to `git push` / `git pull --ff-only` in that folder, and SHALL surface the
outcome non-blockingly via a toast — never blocking the UI and never throwing out
of the menu. Both run git NON-INTERACTIVELY (no credential / passphrase /
host-key prompt) so a sync against a remote that would otherwise prompt fails
fast instead of hanging. Pull is fast-forward only, so a divergent branch fails
cleanly without ever leaving the worktree mid-merge.

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

#### Scenario: Push or pull fails

- **WHEN** a Push or Pull cannot complete (no upstream, rejected non-fast-forward,
  a divergent branch on pull, or no network / a remote that would prompt)
- **THEN** the app shows a failure toast naming the project and carrying git's own
  error message
- **AND** the menu action does not throw, and a failed pull leaves the worktree
  untouched (no mid-merge state).

#### Scenario: Project has no folder

- **WHEN** the user picks Push or Pull on a project that has no folder set
- **THEN** the app shows a toast warning there is no folder to sync
- **AND** does not invoke git.
