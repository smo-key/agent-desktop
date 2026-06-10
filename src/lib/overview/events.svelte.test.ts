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
import type { AgentEvent } from './events';

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

  it('seed does not overwrite an existing timeline (synthetic + live events survive)', async () => {
    // REGRESSION: seed re-runs on every session-set change. A wholesale per-pane replace
    // would clobber a frontend-only synthetic interrupt Stop (re-pinning the pane to
    // `working`) and drop live events arriving during the `events_for` round-trip.
    const store = new EventStore();
    store.ingest(ev('UserPromptSubmit'));
    store.ingest(ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:x' }));
    store.markInterrupt('p1'); // frontend-only synthetic Stop → waiting
    expect(store.activityFor('p1').status).toBe('waiting');

    // The Rust ring lacks the synthetic Stop; a re-seed must NOT clobber the live timeline.
    invokeMock.mockResolvedValueOnce({
      p1: [ev('UserPromptSubmit'), ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:x' })]
    });
    const n = await store.seed([{ paneId: 'p1', sessionId: 's1', cwd: null }]);
    expect(n).toBe(0); // nothing seeded — p1 already has a live timeline
    expect(store.activityFor('p1').status).toBe('waiting'); // still interrupted, not working
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
