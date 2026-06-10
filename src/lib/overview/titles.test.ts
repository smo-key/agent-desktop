import { describe, expect, it } from 'vitest';
import { shouldRequest, TITLE_THROTTLE_MS, type TitleEntry } from './titles.svelte';

// Pure gating for session-title regeneration: request only when the user's messages
// changed (hash differs), not already fetching that hash, and not throttled.

const entry = (hash: string | null): TitleEntry => ({ title: 'X', hash });

describe('shouldRequest', () => {
  it('requests when there is a user hash and no title yet', () => {
    expect(shouldRequest(undefined, undefined, 'h1', 0, 1_000_000)).toBe(true);
  });

  it('does not request without a user hash (user has sent nothing)', () => {
    expect(shouldRequest(undefined, undefined, null, 0, 1_000_000)).toBe(false);
  });

  it('does not request when the title is already for the current hash', () => {
    expect(shouldRequest(entry('h1'), undefined, 'h1', 0, 1_000_000)).toBe(false);
  });

  it('requests when the user hash changed', () => {
    expect(shouldRequest(entry('h1'), undefined, 'h2', 0, 1_000_000)).toBe(true);
  });

  it('does not double-request a hash already in flight', () => {
    expect(shouldRequest(entry('h1'), 'h2', 'h2', 0, 1_000_000)).toBe(false);
  });

  it('throttles repeated requests for the same pane', () => {
    const now = 1_000_000;
    // A recent attempt (within the window) is throttled even on a new hash.
    expect(shouldRequest(entry('h1'), undefined, 'h2', now - 1000, now)).toBe(false);
    // After the window, it requests.
    expect(shouldRequest(entry('h1'), undefined, 'h2', now - TITLE_THROTTLE_MS - 1, now)).toBe(true);
  });

  it('never requests for a MANUAL entry, even when the user hash changed', () => {
    // A custom title is sticky: automatic title generation STOPS for that session.
    const manual: TitleEntry = { title: 'My custom title', hash: 'h1', manual: true };
    // Hash changed (h2 != h1) and the throttle window has elapsed — normally a
    // request — but the manual marker short-circuits it.
    expect(shouldRequest(manual, undefined, 'h2', 0, 1_000_000)).toBe(false);
    // Even with no prior hash recorded on the manual entry.
    const manualNoHash: TitleEntry = { title: 'Custom', hash: null, manual: true };
    expect(shouldRequest(manualNoHash, undefined, 'h9', 0, 1_000_000)).toBe(false);
  });
});
