# project-worktrees Specification

## Purpose

The worktree management UI lets a user work with a project's git worktrees under
`<repo>/.worktrees/`: view the accumulated worktrees, open a session into one,
and prune them. Worktrees are created, listed, and removed manually from this
view — there is no automatic create-on-launch or prune-on-close.

## Requirements

### Requirement: Manage a project's worktrees

The system SHALL provide a way to view a project's existing worktrees (those under
the project repository's `.worktrees`), showing at least each worktree's path,
branch, and whether it is clean or has changes. From this view the user SHALL be
able to open a session into an existing worktree and to prune (remove) a worktree.
Pruning a worktree that has changes SHALL require explicit confirmation (a forced
removal) so that work is not discarded accidentally.

#### Scenario: Listing accumulated worktrees

- **WHEN** the user opens the worktree-management view for a project that has kept
  worktrees
- **THEN** each worktree is listed with its path, branch, and clean/changed state

#### Scenario: Opening a session into an existing worktree

- **WHEN** the user chooses to open a worktree from the management view
- **THEN** a session is launched with that worktree path as its working directory

#### Scenario: Pruning a worktree

- **WHEN** the user prunes a clean worktree
- **THEN** the worktree is removed
- **AND** pruning a worktree that has changes first requires explicit confirmation
  before it is force-removed
