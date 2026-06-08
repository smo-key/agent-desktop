import { describe, expect, it, vi } from 'vitest';

// Executor tests. Named `*.svelte.test.ts` so vitest compiles the module's runes
// (the singleton at the bottom touches `$state` stores on import). We exercise the
// dispatcher + handlers through INJECTED fakes — no live workspace / PTY / Tauri.
// Scenario coverage mirrors the agent-orchestration-runtime spec.

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => '') }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import {
  OrchestrationExecutor,
  type ExecutorDeps
} from './executor.svelte';
import type { Specialist } from '../specialists/specialists';

const PROJ = 'proj-1';

/** A minimal located-pane fake. */
function pane(paneId: string, over: Partial<{ projectId: string | null; closed: boolean; specialist: string | null; cwd: string | null; program: string }> = {}) {
  return {
    workspaceId: 'ws-1',
    paneId,
    session: {
      program: over.program ?? 'claude',
      cwd: over.cwd ?? '/repo',
      projectId: over.projectId === undefined ? PROJ : over.projectId,
      closed: over.closed ?? false,
      specialist: over.specialist ?? undefined
    } as any
  };
}

/** Build deps with sensible defaults; override per test. A `replies` array captures
 *  every reply so each test asserts the outcome. */
function makeDeps(over: Partial<ExecutorDeps> = {}) {
  const replies: Array<{ id: number; outcome: any }> = [];
  const launched: any[] = [];
  const sent: Array<{ paneId: string; text: string }> = [];
  const archived: string[] = [];
  const unarchived: string[] = [];
  const deps: ExecutorDeps = {
    reply: (id, outcome) => {
      replies.push({ id, outcome });
    },
    locate: () => null,
    panesInProject: () => [],
    statusOf: () => 'waiting',
    readActivity: () => ({ summary: null, messages: [], question: null, contextPct: null }),
    sendToPane: (paneId, text) => {
      sent.push({ paneId, text });
      return true;
    },
    projectPath: (id) => (id === PROJ ? '/repo' : null),
    loadSpecialist: async () => ({ name: 's', description: 'd', prompt: 'P' }) as Specialist,
    launch: (plan) => {
      launched.push(plan);
      return 'pane-new';
    },
    coordinatorFor: () => null,
    archive: (paneId) => archived.push(paneId),
    unarchive: (paneId) => unarchived.push(paneId),
    schedule: (run) => run(), // run synchronously for deterministic tests
    ...over
  };
  return { deps, replies, launched, sent, archived, unarchived };
}

describe('OrchestrationExecutor — scoping & safety (4.6)', () => {
  it('rejects an op with no orchestrator projectId in args', async () => {
    const { deps, replies } = makeDeps();
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'list_agents', args: {} });
    expect(replies[0].outcome.error).toMatch(/projectId/);
  });

  it('rejects a cross-project target (no action)', async () => {
    const { deps, replies, archived } = makeDeps({
      locate: () => pane('p1', { projectId: 'other' })
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 2, op: 'archive_agent', args: { projectId: PROJ, paneId: 'p1' } });
    expect(replies[0].outcome.error).toMatch(/outside/);
    expect(archived).toEqual([]);
  });

  it('rejects a nonexistent target', async () => {
    const { deps, replies } = makeDeps({ locate: () => null });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 3, op: 'inspect_agent', args: { projectId: PROJ, paneId: 'gone' } });
    expect(replies[0].outcome.error).toMatch(/no such agent/);
  });

  it('rejects a closed target', async () => {
    const { deps, replies } = makeDeps({ locate: () => pane('p1', { closed: true }) });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 4, op: 'message_agent', args: { projectId: PROJ, paneId: 'p1', text: 'hi' } });
    expect(replies[0].outcome.error).toMatch(/closed/);
  });

  it('rejects an unknown op', async () => {
    const { deps, replies } = makeDeps();
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 5, op: 'frobnicate', args: { projectId: PROJ } });
    expect(replies[0].outcome.error).toMatch(/unknown op/);
  });
});

describe('OrchestrationExecutor — message_agent (4.3 / 4.6 idle gating)', () => {
  it('delivers text to an idle target', async () => {
    const { deps, replies, sent } = makeDeps({
      locate: () => pane('p1'),
      statusOf: () => 'waiting'
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'message_agent', args: { projectId: PROJ, paneId: 'p1', text: 'go' } });
    expect(sent).toEqual([{ paneId: 'p1', text: 'go' }]);
    expect(replies[0].outcome.result.delivered).toBe(true);
  });

  it('defers a busy target then delivers once it goes idle', async () => {
    let calls = 0;
    const { deps, replies, sent } = makeDeps({
      locate: () => pane('p1'),
      statusOf: () => (++calls < 3 ? 'working' : 'waiting') // busy twice, then idle
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'message_agent', args: { projectId: PROJ, paneId: 'p1', text: 'go' } });
    expect(sent).toEqual([{ paneId: 'p1', text: 'go' }]);
    expect(replies[0].outcome.result.delivered).toBe(true);
  });

  it('errors when the target stays busy past the bounded wait', async () => {
    // schedule that advances "time" by jumping straight to the deadline via Date.now stub.
    const realNow = Date.now;
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    const { deps, replies, sent } = makeDeps({
      locate: () => pane('p1'),
      statusOf: () => 'working',
      schedule: (run) => {
        t += 1000; // advance past BUSY_WAIT_MS over several retries
        run();
      }
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'message_agent', args: { projectId: PROJ, paneId: 'p1', text: 'go' } });
    expect(sent).toEqual([]);
    expect(replies[0].outcome.error).toMatch(/busy/);
    Date.now = realNow;
  });
});

describe('OrchestrationExecutor — read/list/inspect (4.3/4.4)', () => {
  it('read_agent returns recent activity', async () => {
    const { deps, replies } = makeDeps({
      locate: () => pane('p1'),
      statusOf: () => 'waiting',
      readActivity: () => ({ summary: 'did a thing', messages: ['m1', 'm2'], question: 'q?', contextPct: 42 })
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'read_agent', args: { projectId: PROJ, paneId: 'p1' } });
    expect(replies[0].outcome.result).toMatchObject({
      paneId: 'p1',
      summary: 'did a thing',
      messages: ['m1', 'm2'],
      question: 'q?',
      contextPct: 42
    });
  });

  it('list_agents returns every project pane incl. user-started + archived', async () => {
    const { deps, replies } = makeDeps({
      panesInProject: () => [pane('p1'), pane('p2', { specialist: 'reviewer' }), pane('p3', { closed: true })]
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'list_agents', args: { projectId: PROJ } });
    const agents = replies[0].outcome.result.agents;
    expect(agents.map((a: any) => a.paneId)).toEqual(['p1', 'p2', 'p3']);
    expect(agents[1].specialist).toBe('reviewer');
    expect(agents[2].archived).toBe(true);
  });

  it('inspect_agent returns a single agent identity + state', async () => {
    const { deps, replies } = makeDeps({
      locate: () => pane('p1', { specialist: 'tester' }),
      statusOf: () => 'working'
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'inspect_agent', args: { projectId: PROJ, paneId: 'p1' } });
    expect(replies[0].outcome.result).toMatchObject({
      paneId: 'p1',
      status: 'working',
      specialist: 'tester',
      projectId: PROJ
    });
  });
});

describe('OrchestrationExecutor — spawn_agent (4.2)', () => {
  it('launches a plain agent with the prompt and returns its id', async () => {
    const { deps, replies, launched } = makeDeps();
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'spawn_agent', args: { projectId: PROJ, prompt: 'build it' } });
    expect(launched[0]).toMatchObject({ program: 'claude', cwd: '/repo', initialInput: 'build it', projectId: PROJ });
    expect(launched[0].specialist).toBeUndefined();
    // No coordinator for the project → no attribution back-reference.
    expect(launched[0].coordinatorPaneId).toBeUndefined();
    expect(replies[0].outcome.result).toEqual({ paneId: 'pane-new', specialist: null });
  });

  it('attributes the spawned agent to the project coordinator (task 6.5)', async () => {
    const { deps, launched } = makeDeps({ coordinatorFor: () => 'coord-pane' });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'spawn_agent', args: { projectId: PROJ, prompt: 'go' } });
    expect(launched[0].coordinatorPaneId).toBe('coord-pane');
  });

  it('composes a specialist launch and records the specialist on the pane', async () => {
    const { deps, replies, launched } = makeDeps({
      loadSpecialist: async () => ({ name: 'reviewer', description: 'd', prompt: 'You review.', model: 'claude-sonnet-4-6', tools: ['Read', 'Grep'] }) as Specialist
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'spawn_agent', args: { projectId: PROJ, prompt: 'review', specialist: 'reviewer' } });
    expect(launched[0].specialist).toBe('reviewer');
    expect(launched[0].extraArgs).toEqual([
      '--append-system-prompt',
      'You review.',
      '--model',
      'claude-sonnet-4-6',
      '--allowedTools',
      'Read',
      'Grep'
    ]);
    expect(replies[0].outcome.result).toEqual({ paneId: 'pane-new', specialist: 'reviewer' });
  });

  it('errors when the specialist cannot be loaded (no launch)', async () => {
    const { deps, replies, launched } = makeDeps({
      loadSpecialist: async () => {
        throw new Error('not found');
      }
    });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'spawn_agent', args: { projectId: PROJ, prompt: 'x', specialist: 'ghost' } });
    expect(launched).toEqual([]);
    expect(replies[0].outcome.error).toMatch(/could not load specialist/);
  });
});

describe('OrchestrationExecutor — archive / unarchive (4.5)', () => {
  it('archive_agent archives an in-project pane', async () => {
    const { deps, replies, archived } = makeDeps({ locate: () => pane('p1') });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'archive_agent', args: { projectId: PROJ, paneId: 'p1' } });
    expect(archived).toEqual(['p1']);
    expect(replies[0].outcome.result.archived).toBe(true);
  });

  it('unarchive_agent restores a CLOSED in-project pane', async () => {
    const { deps, replies, unarchived } = makeDeps({ locate: () => pane('p1', { closed: true }) });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'unarchive_agent', args: { projectId: PROJ, paneId: 'p1' } });
    expect(unarchived).toEqual(['p1']);
    expect(replies[0].outcome.result.unarchived).toBe(true);
  });

  it('unarchive_agent rejects a cross-project pane', async () => {
    const { deps, replies, unarchived } = makeDeps({ locate: () => pane('p1', { projectId: 'other', closed: true }) });
    const ex = new OrchestrationExecutor(deps);
    await ex.onRequest({ id: 1, op: 'unarchive_agent', args: { projectId: PROJ, paneId: 'p1' } });
    expect(unarchived).toEqual([]);
    expect(replies[0].outcome.error).toMatch(/outside/);
  });
});
