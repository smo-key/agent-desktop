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
  git?: { worktree?: string | null; worktree_root?: string | null } | null;
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
  const name = snapshot?.git?.worktree;
  if (!name) return null;
  // The worktree's ROOT, not wherever the session happens to be standing: the
  // reported dir is its CURRENT one, so a session that has already `cd`ed deeper
  // would otherwise pin the pane to that subdir permanently (the subdir is still
  // inside the worktree, so the worktree gate alone allows it), and the subagent
  // reader — which locates sidecars by exact dir — would never find them.
  //
  // The wrapper reports the root (`git rev-parse --show-toplevel`), but we use it
  // for its DIRECTORY NAME and then cut the session's OWN reported path at that
  // segment, rather than adopting git's text verbatim: git resolves symlinks
  // (`/var` → `/private/var` on macOS) while the session reports the unresolved
  // path, and the pane's dir has to match the session's form — that form is what
  // Claude encodes into its project-dir name, which is how the subagent reader
  // finds the session's sidecars.
  //
  // The reported root's basename is also what makes this reliable at all: git's
  // admin NAME gains a counter suffix on a basename collision (`feature-x` →
  // `feature-x1`) and then matches no segment of the path. The admin name is only
  // the fallback for a snapshot written by an older wrapper, and the reported dir
  // itself the last resort — never adopting nothing when a worktree is confirmed.
  const root = typeof snapshot?.git?.worktree_root === 'string' ? snapshot.git.worktree_root.trim() : '';
  const reported = typeof snapshot?.cwd === 'string' ? snapshot.cwd.trim() : '';
  const marker = root ? baseName(root) : name;
  const adopt = worktreeRootOf(reported, marker) || worktreeRootOf(reported, name) || root || reported;
  if (!adopt || adopt === session.cwd) return null;
  return adopt;
}

/** The last non-empty path segment of `dir` (either separator). Pure. */
function baseName(dir: string): string {
  const parts = dir.split(/[/\\]/).filter((p) => p !== '');
  return parts[parts.length - 1] ?? '';
}

/**
 * The ancestor of `dir` (or `dir` itself) whose last path segment is `name` — the
 * root of the linked worktree the session is inside. Null when no segment matches,
 * which leaves the pane un-adopted rather than guessing: git derives a worktree's
 * admin name from its directory's basename, so a mismatch means we cannot tell
 * where the worktree starts. Handles both separators and a trailing one. Pure.
 */
export function worktreeRootOf(dir: string, name: string): string | null {
  const parts = dir.split(/[/\\]/);
  // Walk from the DEEPEST match outward: with nested repos the innermost wins.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== '' && parts[i] === name) return parts.slice(0, i + 1).join('/');
  }
  return null;
}

/**
 * The panes whose ADOPTED worktree dir no longer exists, and must therefore
 * forget it (session-launcher: "A worktree session resumes in its worktree").
 * A worktree is often removed once its branch merges, and the dir is persisted —
 * so without this the pane would keep trying to spawn in a missing directory for
 * the rest of its life, with nothing in the app able to clear the field. Forgetting
 * it falls the pane back to the folder it was launched in. Pure: `exists` does the
 * IO for the caller.
 */
export function paneWorktreesToForget(
  panes: ReadonlyArray<{ paneId: string; worktreeCwd?: string }>,
  exists: (dir: string) => boolean
): string[] {
  const out: string[] = [];
  for (const p of panes) {
    if (p.worktreeCwd && !exists(p.worktreeCwd)) out.push(p.paneId);
  }
  return out;
}
