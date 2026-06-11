import { describe, expect, it, vi } from 'vitest';

// EventStore tests. Named `*.svelte.test.ts` so vitest compiles the store's
// `$state` rune. Titles match the activity-timeline `#### Scenario:` names
// (Timeline accumulates tool events / Timeline seeded on mount / Pending question
// shown from event). The live socket→`overview://event` push is exercised by the
// Rust `accepted_event_is_emitted_and_buffered` test; here we assert the store's
// ingest + seed shaping.

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { EventStore } from './events.svelte';
import { EVENT_RING_CAP, type AgentEvent } from './events';

function ev(name: string, over: Partial<AgentEvent> = {}): AgentEvent {
  return { paneId: 'p1', sessionId: 's1', hookEventName: name, ts: 0, ...over };
}

describe('EventStore', () => {
  it('Timeline accumulates tool events', () => {
    const store = new EventStore();
    store.ingest(ev('PreToolUse', { toolName: 'Read', summary: 'Read:a' }));
    store.ingest(ev('PreToolUse', { toolName: 'Edit', summary: 'Edit:b' }));
    store.ingest(ev('PostToolUse', { toolName: 'Edit' }));
    store.ingest(ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:c' }));
    const timeline = store.timeline('p1');
    expect(timeline.map((e) => e.hookEventName)).toEqual([
      'PreToolUse',
      'PreToolUse',
      'PostToolUse',
      'PreToolUse'
    ]);
    // The derived activity reflects the latest in-flight tool.
    expect(store.activityFor('p1').currentAction).toBe('Bash:c');
  });

  it('Pending question shown from event', () => {
    const store = new EventStore();
    store.ingest(
      ev('PreToolUse', {
        toolName: 'AskUserQuestion',
        question: { questions: [{ question: 'Ship it?', options: [{ label: 'Yes' }] }] }
      })
    );
    const a = store.activityFor('p1');
    expect(a.status).toBe('waiting');
    expect(a.question).toBe('Ship it?');
    expect(a.questions?.[0].options[0].label).toBe('Yes');
  });

  it('Timeline seeded on mount', async () => {
    invokeMock.mockResolvedValueOnce({
      p1: [ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:make' }), ev('PostToolUse', { toolName: 'Bash' })],
      bad: 'not-an-array'
    });
    const store = new EventStore();
    const n = await store.seed([{ paneId: 'p1', sessionId: 's1', cwd: null }]);
    expect(n).toBe(2);
    expect(store.timeline('p1')).toHaveLength(2);
    // A malformed session value is ignored, not stored.
    expect(store.timeline('bad')).toHaveLength(0);
  });

  // REGRESSION: a coordinator prompted once then running a single long turn emits more
  // than the ring cap of events, evicting its original UserPromptSubmit from the bounded
  // ring. The sticky latch must keep everPrompted true so the busy coordinator stays
  // Working (out of the Needs-you lane) rather than flipping back to Waiting.
  it('everPrompted survives the prompt being evicted from the ring', () => {
    const store = new EventStore();
    store.ingest(ev('UserPromptSubmit', { ts: 0 }));
    for (let i = 0; i < EVENT_RING_CAP + 50; i++) {
      store.ingest(
        ev(i % 2 === 0 ? 'PreToolUse' : 'PostToolUse', { toolName: 'Bash', summary: `b${i}`, ts: i + 1 })
      );
    }
    // The bounded ring no longer holds the UserPromptSubmit…
    expect(store.timeline('p1').some((e) => e.hookEventName === 'UserPromptSubmit')).toBe(false);
    // …but the sticky latch keeps everPrompted true.
    expect(store.activityFor('p1').everPrompted).toBe(true);
  });

  it('everPrompted latches from seeded turn activity without a prompt event', async () => {
    // A resume whose seeded slice holds only later turn activity (no UserPromptSubmit)
    // still proves the session was prompted, so the latch is set.
    invokeMock.mockResolvedValueOnce({
      p1: [ev('PostToolUse', { toolName: 'Bash', ts: 5 }), ev('Stop', { ts: 6 })]
    });
    const store = new EventStore();
    await store.seed([{ paneId: 'p1', sessionId: 's1', cwd: null }]);
    expect(store.activityFor('p1').everPrompted).toBe(true);
  });

  // INTERRUPT: pressing Esc aborts the in-flight tool, but claude fires NO PostToolUse
  // for the aborted tool (and no Stop), so the event-sourced status would otherwise stay
  // pinned at `working` forever. `markInterrupt` records a synthetic turn-end so the row
  // returns to `waiting` (Needs-input).
  it('Interrupt returns a mid-tool working pane to waiting', () => {
    const store = new EventStore();
    store.ingest(ev('UserPromptSubmit'));
    store.ingest(ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:sleep 999' }));
    expect(store.activityFor('p1').status).toBe('working');

    store.markInterrupt('p1');

    expect(store.activityFor('p1').status).toBe('waiting');
    expect(store.activityFor('p1').currentAction).toBeNull();
    // The injected turn-end is marked SYNTHETIC so task auto-archive can tell a user
    // interrupt from a genuine "returned to user".
    expect(store.timeline('p1').at(-1)?.synthetic).toBe(true);
  });

  it('Seed merge preserves a synthetic interrupt Stop', async () => {
    // REGRESSION: seed re-runs on every session-set change. A wholesale per-pane replace
    // would clobber the frontend-only synthetic interrupt Stop (the Rust ring can't
    // reproduce it), re-pinning the interrupted pane back to `working`.
    const store = new EventStore();
    store.ingest(ev('UserPromptSubmit'));
    store.ingest(ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:x' }));
    store.markInterrupt('p1'); // frontend-only synthetic Stop → waiting
    expect(store.activityFor('p1').status).toBe('waiting');

    // The Rust ring snapshot lacks the synthetic Stop; the merge must keep it.
    invokeMock.mockResolvedValueOnce({
      p1: [ev('UserPromptSubmit'), ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:x' })]
    });
    await store.seed([{ paneId: 'p1', sessionId: 's1', cwd: null }]);
    expect(store.activityFor('p1').status).toBe('waiting'); // synthetic Stop survived
    expect(store.timeline('p1').at(-1)?.synthetic).toBe(true); // and is still the last event
  });

  it('Seed merge preserves a live event newer than the snapshot', async () => {
    // A live turn-ending Stop lands at ts 100 (during the `events_for` round-trip) while
    // the snapshot was taken earlier (only the UserPromptSubmit at ts 50). The merge must
    // not drop the newer live Stop, which would otherwise leave the pane stuck `working`.
    const store = new EventStore();
    store.ingest(ev('UserPromptSubmit', { ts: 50 }));
    store.ingest(ev('Stop', { ts: 100 }));
    invokeMock.mockResolvedValueOnce({ p1: [ev('UserPromptSubmit', { ts: 50 })] });
    await store.seed([{ paneId: 'p1', sessionId: 's1', cwd: null }]);
    expect(store.timeline('p1').map((e) => e.hookEventName)).toEqual(['UserPromptSubmit', 'Stop']);
  });

  it('Interrupt is a no-op when the pane is not working', () => {
    const store = new EventStore();
    // No events at all → nothing to interrupt; status stays unknown (→ PTY fallback).
    store.markInterrupt('ghost');
    expect(store.activityFor('ghost').status).toBeNull();
    expect(store.timeline('ghost')).toHaveLength(0);

    // An idle, waiting pane (turn already ended) gets no extra synthetic turn-end — a
    // stray Esc at the prompt must not add timeline noise.
    store.ingest(ev('UserPromptSubmit'));
    store.ingest(ev('Stop'));
    expect(store.activityFor('p1').status).toBe('waiting');
    const before = store.timeline('p1').length;
    store.markInterrupt('p1');
    expect(store.timeline('p1').length).toBe(before);
  });
});
