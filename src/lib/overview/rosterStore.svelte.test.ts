import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared roster store (performance): one ref-counted clock, one derived roster.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { RosterStore } from './rosterStore.svelte';

describe('RosterStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('One shared roster clock serves every consumer', () => {
    const store = new RosterStore();
    expect(store.running).toBe(false);
    const stopA = store.start();
    const stopB = store.start();
    expect(store.running).toBe(true);
    const t0 = store.nowMs;
    vi.advanceTimersByTime(1000);
    expect(store.nowMs).toBeGreaterThan(t0);
    stopA();
    expect(store.running).toBe(true);
    stopB();
    stopB(); // idempotent
    expect(store.running).toBe(false);
  });

  it('exposes an (empty) roster from the module singletons when nothing is open', () => {
    const store = new RosterStore();
    expect(store.rows).toEqual([]);
  });
});
