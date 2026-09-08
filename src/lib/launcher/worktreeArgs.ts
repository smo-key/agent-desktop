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
  // `--worktree` takes an OPTIONAL value, so a name beginning with `-` would be
  // parsed by claude as another flag; strip leading dashes so a name is only
  // ever a name.
  const clean = typeof name === 'string' ? name.trim().replace(/^-+/, '').trim() : '';
  return clean === '' ? ['--worktree'] : ['--worktree', clean];
}

/** The pane fields the worktree-cwd adoption rule reads. */
export interface WorktreeAdoptionSession {
  /** The dir the pane was LAUNCHED in (the project folder for a worktree launch). */
  cwd: string | null;
  /** Launch-time agent args; a worktree launch carries `--worktree`. */
  launchArgs?: string[];
  /** The worktree dir already adopted for this pane, when it has one. */
  worktreeCwd?: string;
}

/** The snapshot fields the rule reads (the statusline wrapper's report). */
export interface WorktreeAdoptionSnapshot {
  /** The session's CURRENT working dir, as claude reports it. */
  cwd?: string | null;
  git?: { worktree?: string | null } | null;
}

/**
 * The worktree dir to ADOPT for a pane, or null to adopt nothing
 * (session-launcher: "A worktree session resumes in its worktree").
 *
 * `claude --worktree` creates the worktree ITSELF and works inside it, so the
 * pane is spawned in the project folder and the real dir is only knowable at
 * runtime, from the session's own report. Adopting it matters twice: a resumed
 * session (restart, or archive → preview) must respawn THERE rather than back in
 * the project folder, and the subagent reader locates a session's sidecars purely
 * by cwd (unlike the transcript reader, which falls back to a scan), so without
 * it a worktree session lists no subagents.
 *
 * Adopted ONCE and only when all of these hold, since `cwd` follows the session's
 * `cd` and must not be chased around:
 *  - the pane was LAUNCHED with `--worktree` (nothing else creates a worktree);
 *  - the session reports it really is inside a linked worktree (`git.worktree`);
 *  - nothing has been adopted for this pane yet;
 *  - the reported dir is non-empty and actually differs from the launch dir.
 * Pure.
 */
export function worktreeCwdToAdopt(
  session: WorktreeAdoptionSession,
  snapshot: WorktreeAdoptionSnapshot | undefined | null
): string | null {
  if (session.worktreeCwd) return null; // adopt once — never chase a later `cd`
  if (!session.launchArgs?.includes('--worktree')) return null;
  if (!snapshot?.git?.worktree) return null;
  const reported = typeof snapshot.cwd === 'string' ? snapshot.cwd.trim() : '';
  if (!reported || reported === session.cwd) return null;
  return reported;
}
