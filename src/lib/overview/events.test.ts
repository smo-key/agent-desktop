import { describe, expect, it } from 'vitest';
import { appendBounded, deriveEventActivity, EVENT_RING_CAP, type AgentEvent } from './events';

// PURE event-derivation tests. The `it(...)` titles are the EXACT `#### Scenario:`
// names from the activity-timeline spec (Requirement: Derive Session Status From
// Events / Surface Current Action) so the coverage gate matches them.

function ev(name: string, over: Partial<AgentEvent> = {}): AgentEvent {
  return { paneId: 'p1', sessionId: 's1', hookEventName: name, ts: 0, ...over };
}

const ASK = ev('PreToolUse', {
  toolName: 'AskUserQuestion',
  summary: 'AskUserQuestion',
  question: {
    questions: [
      {
        header: 'DB',
        question: 'Postgres or MySQL?',
        multiSelect: false,
        options: [
          { label: 'Postgres', description: 'relational' },
          { label: 'MySQL', description: '' }
        ]
      }
    ]
  }
});

describe('deriveEventActivity', () => {
  it('Working from in-flight tool', () => {
    const a = deriveEventActivity([ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:npm test' })]);
    expect(a.status).toBe('working');
  });

  it('Session start alone is not working', () => {
    // A freshly started, promptless session must NOT be pinned to "working": it
    // returns null so the roster's PTY heuristic decides (working while the TUI
    // boots, then waiting once it goes quiet).
    expect(deriveEventActivity([ev('SessionStart')]).status).toBeNull();
    // A SessionStart trailing earlier completed work is likewise idle, not working.
    const resumed = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:npm test' }),
      ev('PostToolUse', { toolName: 'Bash' }),
      ev('Stop'),
      ev('SessionStart')
    ]);
    expect(resumed.status).toBeNull();
  });

  it('Current action reflects running tool', () => {
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:npm test' })
    ]);
    expect(a.currentAction).toBe('Bash:npm test');
    expect(a.status).toBe('working');
  });

  it('Current action cleared on completion', () => {
    // Matching PostToolUse clears the in-flight action.
    const done = deriveEventActivity([
      ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:npm test' }),
      ev('PostToolUse', { toolName: 'Bash' })
    ]);
    expect(done.currentAction).toBeNull();
    // A turn-ending Stop also clears it.
    const stopped = deriveEventActivity([
      ev('PreToolUse', { toolName: 'Edit', summary: 'Edit:a.ts' }),
      ev('Stop')
    ]);
    expect(stopped.currentAction).toBeNull();
  });

  it('Blocked from pending question', () => {
    const a = deriveEventActivity([ev('UserPromptSubmit'), ASK]);
    expect(a.status).toBe('waiting');
    expect(a.question).toBe('Postgres or MySQL?');
    expect(a.questions).not.toBeNull();
    expect(a.questions?.[0].options).toHaveLength(2);
    expect(a.questions?.[0].options[0].label).toBe('Postgres');
  });

  it('Question cleared on answer', () => {
    // The AskUserQuestion's PostToolUse (answered) clears the pending question.
    const a = deriveEventActivity([ASK, ev('PostToolUse', { toolName: 'AskUserQuestion' })]);
    expect(a.question).toBeNull();
    expect(a.questions).toBeNull();
  });

  it('Done from Stop', () => {
    // Turn complete → waiting (the agent is at the prompt, awaiting your input).
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:x' }),
      ev('PostToolUse', { toolName: 'Bash' }),
      ev('Stop')
    ]);
    expect(a.status).toBe('waiting');
    expect(a.currentAction).toBeNull();
  });

  it('Fallback when no events', () => {
    // No events → no event-sourced status (the roster falls back to the PTY heuristic).
    const a = deriveEventActivity([]);
    expect(a.status).toBeNull();
    expect(a.currentAction).toBeNull();
  });

  it('Timeline accumulates tool events', () => {
    // appendBounded preserves order and bounds the ring.
    let list: AgentEvent[] = [];
    for (const name of ['Read', 'Edit', 'Bash']) {
      list = appendBounded(list, ev('PreToolUse', { toolName: name, summary: `${name}:f` }));
    }
    expect(list.map((e) => e.toolName)).toEqual(['Read', 'Edit', 'Bash']);
    // The ring is bounded to the cap (oldest dropped).
    let big: AgentEvent[] = [];
    for (let i = 0; i < EVENT_RING_CAP + 25; i++) big = appendBounded(big, ev('PostToolUse', { ts: i }));
    expect(big).toHaveLength(EVENT_RING_CAP);
    expect(big[big.length - 1].ts).toBe(EVENT_RING_CAP + 24);
  });
});
