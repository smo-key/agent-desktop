import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRuntime,
  getRuntime,
  noteExit,
  noteOutput,
  runtimeMap
} from './runtime';
import { deriveStatus } from './roster';

// The imperative runtime registry is app-side glue (no spec scenario of its own —
// the status SEMANTICS are covered by roster.test.ts). These tests pin its
// behavior so the Overview's status reads stay correct.

afterEach(() => {
  // The registry is module-global; clear the panes these tests touch.
  for (const id of ['p1', 'p2']) clearRuntime(id);
});

describe('runtime registry', () => {
  it('records output activity and maps to working/waiting via deriveStatus', () => {
    const now = 1_000_000;
    noteOutput('p1', now);
    expect(getRuntime('p1')).toEqual({ lastOutputAt: now, exited: false, exitCode: null });
    // Fresh output => working; later "now" past the window => waiting.
    expect(deriveStatus(getRuntime('p1'), now)).toBe('working');
    expect(deriveStatus(getRuntime('p1'), now + 10_000)).toBe('waiting');
  });

  it('records a clean exit as finished and a non-zero exit as error', () => {
    const now = 2_000_000;
    noteOutput('p1', now);
    noteExit('p1', 0);
    expect(deriveStatus(getRuntime('p1'), now)).toBe('finished');
    noteExit('p2', 1);
    expect(deriveStatus(getRuntime('p2'), now)).toBe('error');
  });

  it('late output after an exit restores the alive (working) state', () => {
    const now = 3_000_000;
    noteExit('p1', 0);
    expect(deriveStatus(getRuntime('p1'), now)).toBe('finished');
    noteOutput('p1', now);
    expect(getRuntime('p1')!.exited).toBe(false);
    expect(deriveStatus(getRuntime('p1'), now)).toBe('working');
  });

  it('clearRuntime drops the entry (status falls back to idle)', () => {
    noteOutput('p1', 4_000_000);
    clearRuntime('p1');
    expect(getRuntime('p1')).toBeUndefined();
    expect(deriveStatus(getRuntime('p1'), 4_000_000)).toBe('idle');
  });

  it('runtimeMap returns detached shallow copies', () => {
    const now = 5_000_000;
    noteOutput('p1', now);
    const m = runtimeMap();
    expect(m.p1).toEqual({ lastOutputAt: now, exited: false, exitCode: null });
    // Mutating the registry afterward must not change the already-taken map.
    noteExit('p1', 1);
    expect(m.p1.exited).toBe(false);
  });
});
