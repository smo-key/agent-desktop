## ADDED Requirements

### Requirement: Snapshot git status names the session's worktree

The statusline wrapper's per-pane snapshot `git` object SHALL carry a `worktree` field: the linked worktree's name (the basename of its git dir) when the session's workspace directory is inside a linked git worktree — one whose `git-dir` differs from its `git-common-dir` — and `null` for a main checkout or a non-git directory. For a linked worktree it SHALL also carry `worktree_root`, the worktree's top-level directory, reported even when the session sits in a subdirectory — the name alone is git's ADMIN name, which gains a counter suffix when another worktree already claimed that basename, and so cannot be relied on to appear in the path. The Rust snapshot model SHALL tolerate both fields' absence.

#### Scenario: Snapshot names a linked worktree
- **WHEN** the statusline runs with a workspace directory that is a linked worktree named `feature-x`
- **THEN** the snapshot's `git.worktree` is `feature-x`

#### Scenario: Snapshot reports the worktree root exactly
- **WHEN** the statusline runs inside a linked worktree, and again from a subdirectory of it
- **THEN** both snapshots report the same worktree root, and a main checkout reports none

#### Scenario: Snapshot reports no worktree in a main checkout
- **WHEN** the statusline runs with a workspace directory that is a repository's main checkout
- **THEN** the snapshot's `git.worktree` is `null`

#### Scenario: Snapshot reports no worktree off-repo
- **WHEN** the statusline runs with a workspace directory that is not inside a git repository
- **THEN** the snapshot's `git.worktree` is `null`
