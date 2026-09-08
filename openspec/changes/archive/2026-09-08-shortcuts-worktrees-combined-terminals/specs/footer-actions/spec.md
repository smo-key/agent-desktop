## ADDED Requirements

### Requirement: Footer shows the focused session's worktree

The footer's right zone SHALL show a worktree pill, next to the model pill, naming the linked git worktree the focused session runs in (from its snapshot's `git.worktree`), and SHALL omit the pill when the focused session is not in a worktree or has no snapshot.

#### Scenario: Worktree pill shown for a worktree session
- **WHEN** the focused pane's snapshot reports worktree `feature-x`
- **THEN** the footer view carries `feature-x` as the worktree and the pill renders it

#### Scenario: Worktree pill omitted outside a worktree
- **WHEN** the focused pane's snapshot reports no worktree, or no pane is focused
- **THEN** the footer view's worktree is null and no pill renders
