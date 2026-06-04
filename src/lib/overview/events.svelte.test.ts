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
});
