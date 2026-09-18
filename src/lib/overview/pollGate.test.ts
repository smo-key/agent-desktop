import { describe, expect, it } from 'vitest';
import { WAKE_FETCH_DELAY_MS, WAKE_GAP_HIDDEN_MS, WAKE_GAP_MS, inWakeFetchHold, isWakeGap, shouldRunTick } from './pollGate';

describe('pollGate', () => {
  it('Visual polls pause while the window is hidden', () => {
    expect(shouldRunTick(1, true, null)).toBe(true);
    for (let t = 1; t <= 12; t++) expect(shouldRunTick(t, false, null)).toBe(false);
  });

  it('Correctness backstops slow down but keep running while hidden', () => {
    const ran = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((t) => shouldRunTick(t, false, 6));
    expect(ran).toEqual([6, 12]);
    expect(shouldRunTick(5, true, 6)).toBe(true); // visible: every tick
  });

  it('A heartbeat gap far beyond its interval is a wake from sleep', () => {
    expect(isWakeGap(0, 1_000, 1_000)).toBe(false); // on time
    expect(isWakeGap(0, 4_000, 1_000)).toBe(false); // throttled timer, not sleep
    expect(isWakeGap(0, 1_000 + WAKE_GAP_MS, 1_000)).toBe(true);
    // Hidden: timers are throttled hard, so only a much larger gap counts.
    expect(isWakeGap(0, 1_000 + WAKE_GAP_MS, 1_000, false)).toBe(false);
    expect(isWakeGap(0, 1_000 + WAKE_GAP_HIDDEN_MS, 1_000, false)).toBe(true);
  });

  it('The remote fetch waits for the network after a wake', () => {
    expect(inWakeFetchHold(null, 5_000)).toBe(false);
    expect(inWakeFetchHold(1_000, 1_000 + WAKE_FETCH_DELAY_MS - 1)).toBe(true);
    expect(inWakeFetchHold(1_000, 1_000 + WAKE_FETCH_DELAY_MS)).toBe(false);
  });
});
