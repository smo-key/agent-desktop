// PURE composition of the `claude` CLI args that start a session in a NEW git
// worktree (session-launcher spec: "Launch A Session In A New Git Worktree").
// `claude --worktree [name]` (`-w`) makes Claude Code create the worktree and
// enter it itself; the desktop only forwards the flag. Framework-free so the
// mapping is unit-tested without a PTY.
//
// These args are LAUNCH-TIME ONLY: they belong on the pane's `launchArgs`, which
// is never persisted, so a restored (`--resume`) pane can never create a second
// worktree.

/** The backends whose CLI accepts `--worktree`. */
const WORKTREE_BACKENDS = new Set<string>(['claude']);

/** Whether `program`'s CLI supports the worktree flag. */
export function supportsWorktree(program: string): boolean {
  return WORKTREE_BACKENDS.has(program);
}

/**
 * The args for a worktree launch: `['--worktree']`, plus the trimmed `name`
 * when one was given. A blank / missing name lets claude pick the name.
 */
export function worktreeLaunchArgs(name?: string | null): string[] {
  const clean = typeof name === 'string' ? name.trim() : '';
  return clean === '' ? ['--worktree'] : ['--worktree', clean];
}
