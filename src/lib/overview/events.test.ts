import { describe, expect, it } from 'vitest';
import {
  appendBounded,
  deriveEventActivity,
  EVENT_RING_CAP,
  impliesEverPrompted,
  type AgentEvent
} from './events';

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

  it('Session start is idle waiting, not working', () => {
    // A freshly started, promptless session is idle at the prompt awaiting your
    // input — a STABLE `waiting`, never "working" (and never bouncing off the
    // PTY heuristic as the idle TUI redraws).
    expect(deriveEventActivity([ev('SessionStart')]).status).toBe('waiting');
    // A SessionStart trailing earlier completed work (a resume) is likewise idle.
    const resumed = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:npm test' }),
      ev('PostToolUse', { toolName: 'Bash' }),
      ev('Stop'),
      ev('SessionStart')
    ]);
    expect(resumed.status).toBe('waiting');
  });

  it('Tracks whether the session has ever been prompted', () => {
    // No events / only a SessionStart → never prompted (sitting at the launch prompt).
    expect(deriveEventActivity([]).everPrompted).toBe(false);
    expect(deriveEventActivity([ev('SessionStart')]).everPrompted).toBe(false);
    // The first UserPromptSubmit (typed or injected) flips it on, and it stays on
    // across later turns — including while a tool is in flight and after a Stop.
    expect(deriveEventActivity([ev('UserPromptSubmit')]).everPrompted).toBe(true);
    expect(
      deriveEventActivity([
        ev('SessionStart'),
        ev('UserPromptSubmit'),
        ev('PreToolUse', { toolName: 'Bash', summary: 'Bash:x' })
      ]).everPrompted
    ).toBe(true);
    expect(
      deriveEventActivity([ev('UserPromptSubmit'), ev('Stop'), ev('SessionStart')]).everPrompted
    ).toBe(true);
    // The store's sticky latch (`stickyEverPrompted`) forces it true even when the ring
    // no longer holds a UserPromptSubmit (the original prompt was evicted in a long turn).
    expect(deriveEventActivity([ev('PostToolUse')], true).everPrompted).toBe(true);
    expect(deriveEventActivity([], true).everPrompted).toBe(true);
    // Without the latch, a ring with no prompt reads false.
    expect(deriveEventActivity([ev('PostToolUse')]).everPrompted).toBe(false);
  });

  it('impliesEverPrompted treats any turn activity as proof of a prompt', () => {
    // A prompt, or any tool-use / turn-boundary event, proves a turn ran; SessionStart /
    // SessionEnd / Notification do not (a freshly launched session has only SessionStart).
    for (const name of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop']) {
      expect(impliesEverPrompted(ev(name))).toBe(true);
    }
    for (const name of ['SessionStart', 'SessionEnd', 'Notification']) {
      expect(impliesEverPrompted(ev(name))).toBe(false);
    }
  });

  it('Clear does not finish the session', () => {
    // `/clear` fires SessionEnd(reason:"clear") but the claude PROCESS continues (a
    // SessionStart follows), so it is idle at the freshly-cleared prompt — `waiting`,
    // NOT `finished` (which would let the inbox auto-archive it out from under the user).
    const cleared = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop'),
      ev('SessionEnd', { reason: 'clear' })
    ]);
    expect(cleared.status).toBe('waiting');

    // A REAL end still finishes: logout / prompt-input-exit / other, or an unknown
    // (absent) reason from an older event.
    expect(deriveEventActivity([ev('SessionEnd', { reason: 'logout' })]).status).toBe('finished');
    expect(deriveEventActivity([ev('SessionEnd', { reason: 'prompt_input_exit' })]).status).toBe(
      'finished'
    );
    expect(deriveEventActivity([ev('SessionEnd')]).status).toBe('finished');
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
