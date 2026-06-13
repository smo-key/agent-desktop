import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRuntime,
  getRuntime,
  noteBusy,
  noteExit,
  noteOutput,
  noteResize,
  noteStatus,
  runtimeMap
} from './runtime';
import { deriveStatus, RESIZE_REDRAW_MS } from './roster';

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

  it('noteStatus records the last derived status as hysteresis memory', () => {
    const now = 6_000_000;
    noteOutput('p1', now);
    noteStatus('p1', 'working');
    expect(getRuntime('p1')!.lastStatus).toBe('working');
    // Quiet within the idle-grace band: the recorded 'working' holds it In flight.
    expect(
      deriveStatus(getRuntime('p1'), now + 5_000, undefined, getRuntime('p1')!.lastStatus)
    ).toBe('working');
    // It is overwritten by the next recorded status.
    noteStatus('p1', 'waiting');
    expect(getRuntime('p1')!.lastStatus).toBe('waiting');
  });

  it('noteBusy stamps the last positive detection; a negative detection holds it (hysteresis)', () => {
    const t1 = 8_000_000;
    // A positive detection stamps terminalBusyAt.
    noteBusy('p1', true, t1);
    expect(getRuntime('p1')!.terminalBusyAt).toBe(t1);
    // A later NEGATIVE detection leaves the timestamp unchanged (the override holds
    // through a flickering/briefly-missed affordance instead of clearing instantly).
    noteBusy('p1', false, t1 + 1_000);
    expect(getRuntime('p1')!.terminalBusyAt).toBe(t1);
    // A later POSITIVE detection re-arms it to the new time (promotion stays responsive).
    noteBusy('p1', true, t1 + 2_000);
    expect(getRuntime('p1')!.terminalBusyAt).toBe(t1 + 2_000);
  });

  it('noteOutput ignores a resize-redraw burst so selecting an idle pane stays waiting', () => {
    const t = 9_000_000;
    // An old real output → the pane is idle (quiet well past the working window).
    noteOutput('p1', t - 10_000);
    expect(deriveStatus(getRuntime('p1'), t)).toBe('waiting');
    // A self-initiated resize at t; the SIGWINCH redraw arrives ~immediately after.
    noteResize('p1', t);
    noteOutput('p1', t + 100);
    // The redraw burst (within RESIZE_REDRAW_MS) does NOT advance lastOutputAt, so
    // the idle pane is not promoted to working by merely being selected.
    expect(getRuntime('p1')!.lastOutputAt).toBe(t - 10_000);
    expect(deriveStatus(getRuntime('p1'), t + 100)).toBe('waiting');
    // Real output PAST the resize window stamps normally → working again.
    const past = t + RESIZE_REDRAW_MS + 1;
    noteOutput('p1', past);
    expect(getRuntime('p1')!.lastOutputAt).toBe(past);
    expect(deriveStatus(getRuntime('p1'), past)).toBe('working');
  });

  it('noteResize never fabricates an entry; with no resize, noteOutput stamps as before', () => {
    // No entry yet → noteResize must not create one (mirrors noteStatus).
    noteResize('p1', 1);
    expect(getRuntime('p1')).toBeUndefined();
    // With no recent resize, output stamps exactly as before (fail-safe).
    const t = 2_000_000;
    noteOutput('p1', t);
    expect(getRuntime('p1')!.lastOutputAt).toBe(t);
    expect(deriveStatus(getRuntime('p1'), t)).toBe('working');
  });

  it('noteStatus never resurrects an idle pane (no entry → stays idle)', () => {
    // A rostered pane with no runtime entry derives `idle` ("not wired yet"). Recording
    // that status must NOT create an entry — otherwise the next tick would read its null
    // lastOutputAt as `working`, flipping a just-spawned zero-output pane to working.
    expect(getRuntime('p1')).toBeUndefined();
    noteStatus('p1', 'idle');
    expect(getRuntime('p1')).toBeUndefined();
    expect(deriveStatus(getRuntime('p1'), 7_000_000)).toBe('idle');
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
