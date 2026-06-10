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
    // A very recent attempt (within the small floor window) is throttled even on
    // a new hash — this coalesces a rapid burst / avoids mid-stream thrash.
    expect(shouldRequest(entry('h1'), undefined, 'h2', now - 100, now)).toBe(false);
    // After the floor window, it requests.
    expect(shouldRequest(entry('h1'), undefined, 'h2', now - TITLE_THROTTLE_MS - 1, now)).toBe(true);
  });

  it('re-requests promptly after a NEW user message (changed hash) once the small floor elapsed', () => {
    // Regression: the old 2-minute throttle blocked refreshing the title for up to
    // 2 min after a request even though the user had just sent a new message. The
    // floor is now small (a few seconds), so a changed hash re-requests promptly.
    const now = 1_000_000;
    const justAfterFloor = now - TITLE_THROTTLE_MS - 1; // a request a few seconds ago
    expect(shouldRequest(entry('h1'), undefined, 'h2', justAfterFloor, now)).toBe(true);
    // And the floor is genuinely small: a request 10 s ago no longer blocks a refresh.
    expect(shouldRequest(entry('h1'), undefined, 'h2', now - 10_000, now)).toBe(true);
    // ...while a request 2 min ago — which the OLD window would have throttled — now requests.
    expect(shouldRequest(entry('h1'), undefined, 'h2', now - 120_000, now)).toBe(true);
  });

  it('still does NOT re-request when the hash is unchanged, even after the floor', () => {
    const now = 1_000_000;
    expect(shouldRequest(entry('h1'), undefined, 'h1', now - 60_000, now)).toBe(false);
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
