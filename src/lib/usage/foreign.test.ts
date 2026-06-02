import { describe, expect, it } from 'vitest';
import { mergeForeign, type ForeignSession } from './foreign.svelte';

// Tests for the PURE foreign-session merge/filter view-model (Milestone 4, design
// D7; requirement "Direct-Watch Fallback For Foreign Sessions"). The Rust watcher
// already excludes app-launched session ids; this client-side guard mirrors that
// filter so an app pane is NEVER shown as "external" even before the next
// `foreign_sessions` round-trip updates the backend exclude-set — and it drops any
// malformed entry / non-array payload so a bad event can't poison the UI.
//
// The Stage-1 Rust tests own the per-scenario titles (foreign_session_task_surfaced
// / context_bridge_fallback / missing_todos_directory_is_not_required) and the
// heartbeat titles; we do NOT duplicate those. The describe/it titles here are the
// REQUIREMENT name "Direct-Watch Fallback For Foreign Sessions" for the canonical
// view-model test of the frontend store.

function fs(sessionId: string, over: Partial<ForeignSession> = {}): ForeignSession {
  return {
    session_id: sessionId,
    task: null,
    context_pct: null,
    ts: null,
    ...over
  };
}

describe('task-detection — Direct-Watch Fallback For Foreign Sessions', () => {
  it('Direct-Watch Fallback For Foreign Sessions', () => {
    const a = fs('aaa', { task: 'Investigating the bug', context_pct: 37, ts: 2500 });
    const b = fs('bbb', { task: 'Reviewing the diff', context_pct: 12, ts: 2400 });
    const mine = fs('mine', { task: 'My app pane', context_pct: 50, ts: 2600 });

    // No app sessions -> every valid foreign session is surfaced, sorted by id.
    expect(mergeForeign([b, a], [])).toEqual([a, b]);

    // The app-session id is excluded (the load-bearing "don't show my own panes"
    // guard), even when the raw list still contains it.
    expect(mergeForeign([a, mine, b], ['mine'])).toEqual([a, b]);

    // Carries the derived task + context + heartbeat through verbatim.
    const [first] = mergeForeign([a], []);
    expect(first.task).toBe('Investigating the bug');
    expect(first.context_pct).toBe(37);
    expect(first.ts).toBe(2500);

    // A null task / null context is preserved (the card renders no label / empty
    // bar), not dropped — a foreign session can exist with neither.
    const bare = fs('ccc');
    expect(mergeForeign([bare], [])).toEqual([bare]);

    // Malformed entries are dropped; the result never throws or includes garbage.
    const malformed: unknown[] = [
      null,
      undefined,
      {}, // no session_id
      { session_id: '' }, // empty
      { session_id: 42 }, // wrong type
      'nope',
      a
    ];
    expect(mergeForeign(malformed, [])).toEqual([a]);

    // A non-array payload yields an empty list (never throws).
    expect(mergeForeign(null, [])).toEqual([]);
    expect(mergeForeign(undefined, [])).toEqual([]);
    expect(mergeForeign({ not: 'an array' }, [])).toEqual([]);

    // Pure: the inputs are not mutated.
    const raw = [b, a];
    mergeForeign(raw, []);
    expect(raw).toEqual([b, a]);
  });
});
