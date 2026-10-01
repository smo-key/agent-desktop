import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coalescedRunner } from './coalesce';

// "Event-Driven Activity Refresh Is Coalesced" (activity-timeline spec). The `it`
// titles are the EXACT `#### Scenario:` names so the scenario-coverage gate maps
// them here.

describe('coalescedRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('A burst of hook events triggers one activity refresh', async () => {
    const fn = vi.fn(async () => {});
    const request = coalescedRunner(fn, 300);
    for (let i = 0; i < 25; i++) request();
    expect(fn).not.toHaveBeenCalled(); // trailing: nothing runs inside the window
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).toHaveBeenCalledTimes(1); // no stray re-runs once the burst is served
  });

  it('A refresh requested while one is in flight runs once afterwards', async () => {
    let release!: () => void;
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => (release = r));
      inFlight--;
    });
    const request = coalescedRunner(fn, 300);
    request();
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(1); // first run started, still pending

    // Several requests while it is in flight: none may overlap it.
    request();
    request();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(1);

    release(); // the first run completes -> exactly one follow-up runs
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it('a failed run does not wedge the runner', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const request = coalescedRunner(fn, 100);
    request();
    await vi.advanceTimersByTimeAsync(100);
    request();
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
