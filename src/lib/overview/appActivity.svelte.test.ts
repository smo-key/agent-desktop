import { describe, expect, it } from 'vitest';
import { AppActivityStore } from './appActivity.svelte';
import { WAKE_GAP_MS } from './pollGate';

describe('AppActivityStore', () => {
  it('A wake from sleep is detected once and triggers a resume', () => {
    const store = new AppActivityStore();
    expect(store.beat(0, 1_000)).toBe(false);
    expect(store.resumes).toBe(0);
    expect(store.lastWakeMs).toBeNull();

    const wokeAt = 2_000 + WAKE_GAP_MS;
    expect(store.beat(1_000, wokeAt)).toBe(true);
    expect(store.resumes).toBe(1);
    expect(store.lastWakeMs).toBe(wokeAt);

    expect(store.beat(wokeAt, wokeAt + 1_000)).toBe(false); // back on schedule
    expect(store.resumes).toBe(1);
  });
});
