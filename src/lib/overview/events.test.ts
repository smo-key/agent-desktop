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

  it('Stop with running background tasks stays working', () => {
    // A `run_in_background` Agent returns immediately (PostToolUse at launch) and the
    // parent ends its turn — but its `Stop` still lists the subagent as running. The
    // session will resume on its own, so it is NOT awaiting the user: no Needs-you lane,
    // no needs-input alert. The current action names the background work.
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Agent', summary: 'Agent' }),
      ev('PostToolUse', { toolName: 'Agent' }),
      ev('Stop', {
        backgroundTasks: [
          { id: 'a1', type: 'subagent', status: 'running', description: 'Reply with PONG' }
        ]
      })
    ]);
    expect(a.status).toBe('working');
    expect(a.currentAction).toBe('Background: Reply with PONG');

    // Several running → a count; a missing description → generic label.
    const b = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', {
        backgroundTasks: [
          { id: 'a1', type: 'subagent', status: 'running', description: 'one' },
          { id: 'a2', type: 'subagent', status: 'done', description: 'finished' },
          { id: 'a3', type: 'workflow', status: 'running' }
        ]
      })
    ]);
    expect(b.status).toBe('working');
    expect(b.currentAction).toBe('2 background tasks');
    const c = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: [{ id: 'a9', type: 'subagent', status: 'running' }] })
    ]);
    expect(c.currentAction).toBe('Background task');
  });

  it('Background task finishing returns the session to waiting', () => {
    // The background agent's SubagentStop still lists it running (claude reports the
    // list mid-completion) — the skip-back keeps the parent working — then the parent is
    // re-invoked and its next Stop carries an empty list → genuinely idle → waiting.
    const running = [{ id: 'a1', type: 'subagent', status: 'running', description: 'd' }];
    const events = [
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Agent', summary: 'Agent' }),
      ev('PostToolUse', { toolName: 'Agent' }),
      ev('Stop', { backgroundTasks: running }),
      ev('SubagentStop', { backgroundTasks: running })
    ];
    expect(deriveEventActivity(events).status).toBe('working');
    const done = deriveEventActivity([...events, ev('Stop', { backgroundTasks: [] })]);
    expect(done.status).toBe('waiting');
    expect(done.currentAction).toBeNull();
  });

  it('Stop without a background task list classifies as before', () => {
    // Older claude / other backends / synthetic interrupts: no field → waiting. So do an
    // empty list, a list with nothing running, and a malformed (non-array) value.
    const base = [ev('UserPromptSubmit'), ev('PreToolUse', { toolName: 'Bash' }), ev('PostToolUse', { toolName: 'Bash' })];
    expect(deriveEventActivity([...base, ev('Stop')]).status).toBe('waiting');
    expect(deriveEventActivity([...base, ev('Stop', { backgroundTasks: [] })]).status).toBe('waiting');
    expect(
      deriveEventActivity([...base, ev('Stop', { backgroundTasks: [{ id: 'x', status: 'done' }] })]).status
    ).toBe('waiting');
    expect(
      deriveEventActivity([...base, ev('Stop', { backgroundTasks: 'nope' as unknown as [] })]).status
    ).toBe('waiting');
    expect(deriveEventActivity([...base, ev('Stop', { backgroundTasks: null })]).status).toBe('waiting');
  });

  it('Only agent-like background tasks keep the session working', () => {
    // claude lists EVERY backgrounded task on a Stop: subagents, workflows, teammates,
    // cloud sessions — but also background shells (`npm run dev`), monitors, and
    // housekeeping. A dev server never exits, so counting it would pin the row In flight
    // forever. Only agent-like tasks (which wake the session and terminate) count.
    const base = [ev('UserPromptSubmit')];
    const shell = deriveEventActivity([
      ...base,
      ev('Stop', { backgroundTasks: [{ id: 's1', type: 'shell', status: 'running', description: 'npm run dev' }] })
    ]);
    expect(shell.status).toBe('waiting');
    const monitor = deriveEventActivity([
      ...base,
      ev('Stop', { backgroundTasks: [{ id: 'm1', type: 'monitor', status: 'running' }, { id: 'd', type: 'dream', status: 'running' }] })
    ]);
    expect(monitor.status).toBe('waiting');
    // An in-process TEAMMATE stays `running` while merely idle (claude tracks idleness in
    // a separate flag it does not forward) and is evicted without any hook, so it would
    // pin the lead In flight for the team's whole lifetime — it must not count.
    expect(
      deriveEventActivity([...base, ev('Stop', { backgroundTasks: [{ id: 't1', type: 'teammate', status: 'running', description: 'w' }] })]).status
    ).toBe('waiting');
    for (const type of ['subagent', 'workflow', 'cloud session']) {
      const a = deriveEventActivity([...base, ev('Stop', { backgroundTasks: [{ id: 'x', type, status: 'running', description: 'd' }] })]);
      expect(a.status, type).toBe('working');
    }
    // Mixed: the shell is ignored, the subagent counts — and the label names only it.
    const mixed = deriveEventActivity([
      ...base,
      ev('Stop', {
        backgroundTasks: [
          { id: 's1', type: 'shell', status: 'running', description: 'npm run dev' },
          { id: 'a1', type: 'subagent', status: 'running', description: 'Review PR' }
        ]
      })
    ]);
    expect(mixed.status).toBe('working');
    expect(mixed.currentAction).toBe('Background: Review PR');
    // An entry with no type at all is not trusted as an agent.
    expect(deriveEventActivity([...base, ev('Stop', { backgroundTasks: [{ status: 'running' }] })]).status).toBe('waiting');
  });

  it('Pending background agents count as running', () => {
    // A queued subagent (concurrency slot busy) is reported `pending`; no hook fires when
    // it flips to running, so it must already count as in-flight work.
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: [{ id: 'a1', type: 'subagent', status: 'pending', description: 'd' }] })
    ]);
    expect(a.status).toBe('working');
    expect(a.currentAction).toBe('Background: d');
  });

  it('Idle notification inherits running background work', () => {
    // claude's idle-prompt Notification can fire while the prompt sits idle awaiting a
    // background agent. It must not flip the row to Needs you: it inherits the preceding
    // Stop's running list. A permission-style Notification with no such Stop is unchanged.
    const running = [{ id: 'a1', type: 'subagent', status: 'running', description: 'd' }];
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: running }),
      ev('Notification', { notification: 'Claude is waiting for your input' })
    ]);
    expect(a.status).toBe('working');
    expect(a.currentAction).toBe('Background: d');
    const b = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: running }),
      ev('SubagentStop', { agentId: 'zzz' }),
      ev('Notification', { notification: 'x' })
    ]);
    expect(b.status).toBe('working');
    // The background subagent's OWN tool events land in the parent's ring (same pane,
    // indistinguishable). They must not sever the Notification from the Stop.
    const c = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: running }),
      ev('PreToolUse', { toolName: 'Read', summary: 'Read:x' }),
      ev('PostToolUse', { toolName: 'Read' }),
      ev('PreToolUse', { toolName: 'Grep', summary: 'Grep:y' }),
      ev('PostToolUse', { toolName: 'Grep' }),
      ev('Notification', { notification: 'Claude is waiting for your input' })
    ]);
    expect(c.status).toBe('working');
    expect(c.currentAction).toBe('Background: d');
    // …but once that agent has reported SubagentStop, nothing is outstanding → waiting.
    const d = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: running }),
      ev('PreToolUse', { toolName: 'Read', summary: 'Read:x' }),
      ev('PostToolUse', { toolName: 'Read' }),
      ev('SubagentStop', { agentId: 'a1' }),
      ev('Notification', { notification: 'Claude is waiting for your input' })
    ]);
    expect(d.status).toBe('waiting');
    // A new prompt between them is a real turn restart: no inheritance.
    expect(
      deriveEventActivity([
        ev('UserPromptSubmit'),
        ev('Stop', { backgroundTasks: running }),
        ev('UserPromptSubmit'),
        ev('Notification')
      ]).status
    ).toBe('waiting');
    expect(deriveEventActivity([ev('UserPromptSubmit'), ev('Stop'), ev('Notification')]).status).toBe('waiting');
    expect(deriveEventActivity([ev('UserPromptSubmit'), ev('Notification')]).status).toBe('waiting');
  });

  it('Long background descriptions are clipped in the current action', () => {
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop', { backgroundTasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'x'.repeat(500) }] })
    ]);
    expect(a.currentAction!.length).toBeLessThanOrEqual(72);
    expect(a.currentAction!.startsWith('Background: xxx')).toBe(true);
  });

  it('Fallback when no events', () => {
    // No events → no event-sourced status (the roster falls back to the PTY heuristic).
    const a = deriveEventActivity([]);
    expect(a.status).toBeNull();
    expect(a.currentAction).toBeNull();
  });

  // agent-status-derivation: a `SubagentStop` fires on the PARENT pane when an
  // in-process Task subagent finishes — the parent's `Task` has NOT returned, so the
  // parent is still mid-turn. It must NOT read as a turn end (no `waiting`, no
  // in-flight clear). The parent's real turn end stays its own `Stop`.

  it('Subagent finishes while the parent Task is in flight', () => {
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Task', summary: 'Task:explore' }),
      ev('SubagentStop')
    ]);
    expect(a.status).toBe('working');
    // The parent Task is still in flight, so its action stays current.
    expect(a.currentAction).toBe('Task:explore');
  });

  it('One of several parallel subagents finishes', () => {
    // Two Tasks in flight; one subagent stops while its sibling (and the parent) run.
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Task', summary: 'Task:a' }),
      ev('PreToolUse', { toolName: 'Task', summary: 'Task:b' }),
      ev('SubagentStop')
    ]);
    expect(a.status).toBe('working');
  });

  it('Trailing SubagentStop preserves a working turn', () => {
    // `PostToolUse[Task]` returned (Task cleared), THEN a trailing `SubagentStop`. The
    // SubagentStop is not a turn boundary for the parent, so the status is read from the
    // last NON-SubagentStop event — the `PostToolUse` → `working` (the parent has the
    // result and is generating its next step). It must NOT drop to `null`/PTY fallback,
    // which would flicker the row (fix-event-status-divergence: the bounce root cause).
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Task', summary: 'Task:a' }),
      ev('PostToolUse', { toolName: 'Task' }),
      ev('SubagentStop')
    ]);
    expect(a.status).toBe('working');
    expect(a.currentAction).toBeNull();
  });

  it('Trailing SubagentStop preserves a completed turn as waiting', () => {
    // The actual flip case: the turn ended (`Stop` → waiting) and ~minutes later a
    // background `SubagentStop` arrives. It preserves the settled `waiting` instead of
    // dropping to `null` (which exposed the row to the flickery PTY/terminalBusy/resize
    // heuristic and bounced it In-flight↔Needs-you).
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Task', summary: 'Task:a' }),
      ev('PostToolUse', { toolName: 'Task' }),
      ev('Stop'),
      ev('SubagentStop')
    ]);
    expect(a.status).toBe('waiting');
    expect(a.currentAction).toBeNull();
  });

  it('Multiple trailing SubagentStops skip back to the last turn boundary', () => {
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('Stop'),
      ev('SubagentStop'),
      ev('SubagentStop'),
      ev('SubagentStop')
    ]);
    expect(a.status).toBe('waiting');
  });

  it('A SubagentStop with no prior turn boundary falls back to the PTY', () => {
    // Only SubagentStop(s) and nothing else → no turn boundary to read → null (PTY).
    expect(deriveEventActivity([ev('SubagentStop')]).status).toBeNull();
    expect(deriveEventActivity([ev('SubagentStop'), ev('SubagentStop')]).status).toBeNull();
  });

  it('The parent\'s own turn end still reads Needs input', () => {
    // After a subagent finishes, the parent's OWN `Stop` still returns it to waiting.
    const a = deriveEventActivity([
      ev('UserPromptSubmit'),
      ev('PreToolUse', { toolName: 'Task', summary: 'Task:a' }),
      ev('SubagentStop'),
      ev('Stop')
    ]);
    expect(a.status).toBe('waiting');
    expect(a.currentAction).toBeNull();
  });

  it('A subagent run proves the session was prompted', () => {
    // A subagent can only run after a prompt — so SubagentStop implies everPrompted
    // (the store's sticky latch), keeping a long-running session out of the never-prompted state.
    expect(impliesEverPrompted(ev('SubagentStop'))).toBe(true);
    expect(deriveEventActivity([ev('SubagentStop')], true).everPrompted).toBe(true);
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
