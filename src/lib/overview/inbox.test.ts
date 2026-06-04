// src/lib/overview/inbox.test.ts
import { describe, expect, it } from 'vitest';
import type { AgentRow, AgentStatus } from './roster';
import {
  isAttention,
  attentionQueue,
  resolveFocus,
  nextInQueue,
  shouldClearPin
} from './inbox';

// Minimal AgentRow factory — only the fields the inbox cores read.
function row(paneId: string, status: AgentStatus): AgentRow {
  return {
    paneId,
    workspaceId: 'w-' + paneId,
    name: paneId,
    cwd: null,
    model: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    status,
    projectId: null
  };
}

describe('isAttention', () => {
  it('treats waiting and error as needing attention', () => {
    expect(isAttention('waiting')).toBe(true);
    expect(isAttention('error')).toBe(true);
    expect(isAttention('working')).toBe(false);
    expect(isAttention('finished')).toBe(false);
    expect(isAttention('idle')).toBe(false);
  });
});

describe('Attention queue surfaces waiting and errored agents', () => {
  it('keeps roster order and includes only waiting/error rows', () => {
    const rows = [
      row('a', 'working'),
      row('b', 'waiting'),
      row('c', 'finished'),
      row('d', 'error')
    ];
    expect(attentionQueue(rows).map((r) => r.paneId)).toEqual(['b', 'd']);
  });
});

describe('Focus resolves to the user selection before the queue', () => {
  it('returns the user-selected row when it still exists', () => {
    const rows = [row('a', 'waiting'), row('b', 'working')];
    expect(resolveFocus(rows, 'b')?.paneId).toBe('b');
  });
});

describe('Focus falls back to the attention queue when nothing is selected', () => {
  it('returns the first attention row when there is no selection', () => {
    const rows = [row('a', 'working'), row('b', 'waiting'), row('c', 'error')];
    expect(resolveFocus(rows, null)?.paneId).toBe('b');
  });

  it('falls back to the queue when the selected pane is gone', () => {
    const rows = [row('a', 'waiting')];
    expect(resolveFocus(rows, 'missing')?.paneId).toBe('a');
  });
});

describe('Focus is empty when nothing needs attention and nothing is selected', () => {
  it('returns null', () => {
    const rows = [row('a', 'working'), row('b', 'finished')];
    expect(resolveFocus(rows, null)).toBe(null);
  });
});

describe('Queue navigation steps through waiting agents', () => {
  it('advances to the next attention row and wraps', () => {
    const rows = [row('a', 'waiting'), row('b', 'error'), row('c', 'waiting')];
    expect(nextInQueue(rows, 'a', 1)).toBe('b');
    expect(nextInQueue(rows, 'c', 1)).toBe('a');
    expect(nextInQueue(rows, 'b', -1)).toBe('a');
  });

  it('returns null when the queue is empty', () => {
    expect(nextInQueue([row('a', 'working')], 'a', 1)).toBe(null);
  });
});

describe('Addressed attention agent advances the focus to the next', () => {
  it('clears the pin when the pinned agent leaves attention', () => {
    // pinned 'a' transitions waiting -> working: pin should clear so the queue takes over
    expect(shouldClearPin('waiting', 'working', true)).toBe(true);
  });

  it('keeps the pin while the agent still needs attention', () => {
    expect(shouldClearPin('waiting', 'waiting', true)).toBe(false);
    expect(shouldClearPin('error', 'waiting', true)).toBe(false);
  });

  it('does nothing when the agent was not pinned', () => {
    expect(shouldClearPin('waiting', 'working', false)).toBe(false);
  });
});
