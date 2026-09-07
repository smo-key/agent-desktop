import { describe, expect, it } from 'vitest';
import { MAX_ACTIVITY, MAX_ENTRY, activityText, emptyActivity, noteActivity } from './terminalActivity';

/** Feed a sequence of reported titles through the ring. */
function run(...titles: string[]) {
  return titles.reduce(noteActivity, emptyActivity());
}

describe('terminal activity ring', () => {
  it('The shell reported activity accumulates', () => {
    const ring = run('~/git/app', 'yarn test', 'yarn test', '  ', 'git status');
    // Blank titles are ignored and a repeat is collapsed.
    expect(ring.entries).toEqual(['~/git/app', 'yarn test', 'git status']);
    expect(activityText(ring)).toBe('~/git/app\nyarn test\ngit status');

    // A shell that re-sets the DIRECTORY title at every prompt (oh-my-zsh sets it
    // in both precmd and preexec) must not make the list — and so the change key,
    // and so a model call — move on every command.
    const alternating = run('~/git/app', 'yarn test', '~/git/app', 'git status', '~/git/app');
    expect(alternating.entries).toEqual(['~/git/app', 'yarn test', 'git status']);
  });

  it('A shell that reports nothing new is never titled', () => {
    expect(activityText(emptyActivity())).toBeNull();
    // A single unchanging title (a plain shell that only reports its directory)
    // says nothing about what the user was doing.
    expect(activityText(run('~/git/app', '~/git/app'))).toBeNull();
    expect(activityText(run('~/git/app', 'vim notes.md'))).toBe('~/git/app\nvim notes.md');
  });

  it('bounds the ring and each entry', () => {
    let ring = emptyActivity();
    for (let i = 0; i < MAX_ACTIVITY + 3; i++) ring = noteActivity(ring, `cmd${i}`);
    expect(ring.entries).toHaveLength(MAX_ACTIVITY);
    expect(ring.entries[0]).toBe('cmd3');
    ring = noteActivity(emptyActivity(), 'x'.repeat(MAX_ENTRY + 50));
    expect(ring.entries[0]).toHaveLength(MAX_ENTRY);
  });
});
