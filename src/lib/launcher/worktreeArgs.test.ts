import { describe, expect, it } from 'vitest';
import { worktreeCwdToAdopt } from './worktreeArgs';

/** A pane launched with `--worktree` in the project folder. */
const launched = { cwd: '/proj', launchArgs: ['--worktree'] };
/** What such a session reports once claude has made its worktree. */
const reported = { cwd: '/proj/.claude/worktrees/feature-x', git: { worktree: 'feature-x' } };

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
