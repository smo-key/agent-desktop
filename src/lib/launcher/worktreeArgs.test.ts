import { describe, expect, it } from 'vitest';
import { paneWorktreesToForget, worktreeCwdToAdopt, worktreeRootOf } from './worktreeArgs';

/** A pane launched with `--worktree` in the project folder. */
const launched = { cwd: '/proj', launchArgs: ['--worktree'] };
/** What such a session reports once claude has made its worktree. */
const reported = {
  cwd: '/proj/.claude/worktrees/feature-x',
  git: { worktree: 'feature-x', worktree_root: '/proj/.claude/worktrees/feature-x' }
};

describe('worktree cwd adoption', () => {
  it('A worktree session resumes in its worktree', () => {
    // The pane was spawned in the project folder; the running session reports the
    // linked worktree claude created for it, and that is what gets adopted.
    expect(worktreeCwdToAdopt(launched, reported)).toBe('/proj/.claude/worktrees/feature-x');
  });

  it('adopts once, so a later cd never moves the pane', () => {
    // Already adopted: a session that `cd`s elsewhere reports a new dir, which is
    // ignored — `workspace.current_dir` tracks the session, not its home.
    const adopted = { ...launched, worktreeCwd: '/proj/.claude/worktrees/feature-x' };
    expect(worktreeCwdToAdopt(adopted, { cwd: '/somewhere/else', git: { worktree: 'feature-x' } })).toBeNull();
  });

  it('A worktree session adopts the reported worktree root', () => {
    // git derives a worktree's ADMIN name from its directory basename but appends a
    // counter on collision (`feature-x` → `feature-x1`), so the name is not reliably
    // a path segment — deriving the root from it would silently never adopt. The
    // wrapper reports the root directly, and that wins.
    expect(
      worktreeCwdToAdopt(launched, {
        cwd: '/proj/.claude/worktrees/shiny-thing/src',
        git: { worktree: 'shiny-thing1', worktree_root: '/proj/.claude/worktrees/shiny-thing' }
      })
    ).toBe('/proj/.claude/worktrees/shiny-thing');
    // An older wrapper reports no root: fall back to deriving it from the name, and
    // to the reported dir when even that does not match — never to nothing.
    expect(
      worktreeCwdToAdopt(launched, {
        cwd: '/proj/.claude/worktrees/feature-x/src',
        git: { worktree: 'feature-x' }
      })
    ).toBe('/proj/.claude/worktrees/feature-x');
    expect(
      worktreeCwdToAdopt(launched, {
        cwd: '/proj/.claude/worktrees/shiny-thing',
        git: { worktree: 'shiny-thing1' }
      })
    ).toBe('/proj/.claude/worktrees/shiny-thing');
  });

  it('A worktree session keeps the path form the session reports', () => {
    // git canonicalizes symlinks (`/var` → `/private/var` on macOS) while the
    // session reports the unresolved path. Claude encodes ITS form into the
    // project-dir name the subagent reader looks up, so the reported root is used
    // for its NAME and the session's own path is cut at that segment.
    expect(
      worktreeCwdToAdopt(
        { cwd: '/var/f/repo', launchArgs: ['--worktree'] },
        {
          cwd: '/var/f/repo/.claude/worktrees/feature-x/src',
          git: {
            worktree: 'feature-x',
            worktree_root: '/private/var/f/repo/.claude/worktrees/feature-x'
          }
        }
      )
    ).toBe('/var/f/repo/.claude/worktrees/feature-x');
  });

  it('A worktree session adopts the worktree root, not a subdirectory', () => {
    // The report is the session's CURRENT dir. If it has already `cd`ed deeper, the
    // subdir is still inside the worktree — so the worktree gate alone would let it
    // pin the pane there for good, and the subagent reader (exact-dir lookup) would
    // never find its sidecars.
    expect(
      worktreeCwdToAdopt(launched, {
        cwd: '/proj/.claude/worktrees/feature-x/src/lib',
        git: { worktree: 'feature-x', worktree_root: '/proj/.claude/worktrees/feature-x' }
      })
    ).toBe('/proj/.claude/worktrees/feature-x');
    expect(worktreeRootOf('/w/feature-x', 'feature-x')).toBe('/w/feature-x');
    expect(worktreeRootOf('/w/feature-x/', 'feature-x')).toBe('/w/feature-x');
    expect(worktreeRootOf('C:\\w\\feature-x\\src', 'feature-x')).toBe('C:/w/feature-x');
    // Nested match: the innermost wins.
    expect(worktreeRootOf('/w/x/deep/x/src', 'x')).toBe('/w/x/deep/x');
    // No segment matches the worktree's name — we cannot tell where it starts, so
    // nothing is adopted rather than guessing.
    expect(worktreeRootOf('/w/other/src', 'feature-x')).toBeNull();
    // Nothing usable at all (no root, an unmatched name, and the reported dir IS
    // the launch dir) adopts nothing.
    expect(
      worktreeCwdToAdopt(launched, { cwd: '/proj', git: { worktree: 'feature-x' } })
    ).toBeNull();
  });

  it('adopts nothing without a worktree launch or a worktree report', () => {
    // A plain session in the same folder, however it reports, is never adopted.
    expect(worktreeCwdToAdopt({ cwd: '/proj' }, reported)).toBeNull();
    expect(worktreeCwdToAdopt({ cwd: '/proj', launchArgs: ['--model', 'opus'] }, reported)).toBeNull();
    // Launched with the flag, but the session is NOT in a linked worktree (the
    // launch failed, or claude reused the main checkout).
    expect(worktreeCwdToAdopt(launched, { cwd: '/proj/sub', git: { worktree: null } })).toBeNull();
    expect(worktreeCwdToAdopt(launched, { cwd: '/proj/sub', git: null })).toBeNull();
    // No snapshot yet, an older wrapper with no cwd, or the launch dir itself.
    expect(worktreeCwdToAdopt(launched, undefined)).toBeNull();
    expect(worktreeCwdToAdopt(launched, { git: { worktree: 'feature-x' } })).toBeNull();
    expect(worktreeCwdToAdopt(launched, { cwd: '   ', git: { worktree: 'feature-x' } })).toBeNull();
    expect(worktreeCwdToAdopt(launched, { cwd: '/proj', git: { worktree: 'feature-x' } })).toBeNull();
  });
});

describe('forgetting a removed worktree', () => {
  it('A pane forgets a worktree dir that no longer exists', () => {
    // A worktree is commonly removed once its branch merges. The dir is persisted,
    // so without this the pane would keep trying to spawn in a missing directory.
    const panes = [
      { paneId: 'p1', worktreeCwd: '/w/gone' },
      { paneId: 'p2', worktreeCwd: '/w/here' },
      { paneId: 'p3' } // never adopted one
    ];
    expect(paneWorktreesToForget(panes, (d) => d === '/w/here')).toEqual(['p1']);
    // Nothing to do when every dir is still there.
    expect(paneWorktreesToForget(panes, () => true)).toEqual([]);
    expect(paneWorktreesToForget([], () => false)).toEqual([]);
  });
});
