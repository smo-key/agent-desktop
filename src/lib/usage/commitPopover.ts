// Pure helpers for the commit-popover interaction on the footer's uncommitted-
// files pill. Kept separate from the Svelte component so the decision functions
// are unit-tested apart from the DOM.
//
// The key design decisions:
//   commitPopoverOpen — whether a click on the pill should open the popover.
//   spawnCommitFromPopover — directly spawns the commit agent WITHOUT a confirm
//     dialog (the popover's "Commit now" button replaces the old confirm step).
//
// The agent-task launcher is the SAME one wired by `setAgentTaskLauncher` in
// prActions (set once by `+page.svelte` at app startup) — no second registration
// needed. `spawnCommitFromPopover` delegates to the exported `spawnCommit` from
// prActions so the shared launcher state is never duplicated.

import { spawnCommit, setAgentTaskLauncher, type PrProject } from '$lib/projects/prActions';

// Re-export so tests (which call setAgentTaskLauncher from prActions) work when
// they import through this module. The launcher is shared state in prActions.
export { setAgentTaskLauncher };

/** Minimal project shape for spawning a commit agent (alias of PrProject). */
export type CommitProject = PrProject;

/**
 * Whether a click on the uncommitted-files pill should OPEN the commit popover.
 * True only when there are actual changes (modified > 0) AND a commit handler
 * is wired (the footer provides one only when a real project folder is bound).
 * An inert pill (0 files, null count, or no handler) must NOT open anything.
 */
export function commitPopoverOpen(
  modified: number | null | undefined,
  hasCommitHandler: boolean
): boolean {
  if (!hasCommitHandler) return false;
  return (modified ?? 0) > 0;
}

/**
 * Directly spawn the commit agent for `project` WITHOUT any confirm dialog.
 * The "Commit now" button in the commit popover replaces the old ConfirmModal —
 * the user already saw the file list and chose to commit, so we spawn immediately.
 * Delegates to `spawnCommit` from prActions, which uses the shared agentTaskLauncher
 * set once at app startup via `setAgentTaskLauncher`.
 */
export function spawnCommitFromPopover(project: CommitProject): void {
  spawnCommit(project);
}
