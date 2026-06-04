import { describe, expect, it } from 'vitest';
import {
  selectOptionKeys,
  freeTextNavKeys,
  answerWithOption,
  answerWithText
} from './answer';
import type { TerminalHandle } from '../layout/terminals';

const DOWN = '\x1b[B';
const ENTER = '\r';

/** A fake terminal handle that records every `sendKeys` payload. */
function fakeHandle(alive = true): TerminalHandle & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    getSelection: () => '',
    hasSelection: () => false,
    paste: () => {},
    send: () => alive,
    sendKeys: (data: string) => {
      if (!alive) return false;
      keys.push(data);
      return true;
    }
  };
}

describe('answer — driving a pending AskUserQuestion menu', () => {
  it('selectOptionKeys: N downs then Enter for the N-th option (0-based)', () => {
    expect(selectOptionKeys(0)).toBe(ENTER);
    expect(selectOptionKeys(1)).toBe(DOWN + ENTER);
    expect(selectOptionKeys(3)).toBe(DOWN + DOWN + DOWN + ENTER);
    // Defensive clamp on bad input.
    expect(selectOptionKeys(-2)).toBe(ENTER);
  });

  it('freeTextNavKeys: navigates past all real options to "Type something"', () => {
    expect(freeTextNavKeys(0)).toBe(ENTER);
    expect(freeTextNavKeys(4)).toBe(DOWN.repeat(4) + ENTER);
  });

  it('answerWithOption sends the select sequence to the pane', () => {
    const h = fakeHandle();
    const ok = answerWithOption('p1', 2, () => h);
    expect(ok).toBe(true);
    expect(h.keys).toEqual([DOWN + DOWN + ENTER]);
  });

  it('answerWithOption returns false when no handle / dead PTY', () => {
    expect(answerWithOption('p1', 0, () => undefined)).toBe(false);
    expect(answerWithOption('p1', 0, () => fakeHandle(false))).toBe(false);
  });

  it('answerWithText (open-ended, no options) types straight into the prompt', () => {
    const h = fakeHandle();
    const ok = answerWithText('p1', 0, 'use sqlite', () => h);
    expect(ok).toBe(true);
    expect(h.keys).toEqual(['use sqlite' + ENTER]);
  });

  it('answerWithText (menu) opens "Type something" then types after the delay', () => {
    const h = fakeHandle();
    const deferred: Array<() => void> = [];
    const ok = answerWithText('p1', 3, 'my own answer', () => h, (fn) => deferred.push(fn));
    expect(ok).toBe(true);
    // First: navigate to the free-text entry (3 downs + Enter).
    expect(h.keys).toEqual([DOWN.repeat(3) + ENTER]);
    // The text is sent only once the scheduled callback runs (after render).
    deferred.forEach((fn) => fn());
    expect(h.keys).toEqual([DOWN.repeat(3) + ENTER, 'my own answer' + ENTER]);
  });

  it('answerWithText never synthesizes an answer for blank text', () => {
    const h = fakeHandle();
    expect(answerWithText('p1', 2, '   ', () => h)).toBe(false);
    expect(h.keys).toEqual([]);
  });

  // Spec scenario: "Answer a pending question from the overview" — end-to-end over
  // a fake handle: clicking an option drives the menu; a blank answer is a no-op.
  it('Answer a pending question from the overview', () => {
    const h = fakeHandle();
    // Click the 2nd option (0-based index 1): one down + Enter.
    expect(answerWithOption('p1', 1, () => h)).toBe(true);
    expect(h.keys).toEqual([DOWN + ENTER]);
    // The user's own typed answer never invents input when blank.
    expect(answerWithText('p1', 2, '', () => h)).toBe(false);
  });
});
