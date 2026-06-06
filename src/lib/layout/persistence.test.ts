import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Debouncer,
  PERSIST_VERSION,
  respawnLeaves,
  restoreState,
  serializeState,
  type PersistedState,
  type RestoredWorkspace
} from './persistence';
import { freshWorkspace, type Leaf, type Node, type Split, type Workspace } from './tree';

// ---------------------------------------------------------------------------
// Test helpers — deterministic ids + small tree/entry builders. Everything here
// is framework-free; the persistence module has no Svelte/Tauri imports so it
// runs under the default (node) Vitest environment with no DOM.
// ---------------------------------------------------------------------------

function ids(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function leaf(id: string, paneId: string): Leaf {
  return { type: 'leaf', id, paneId };
}

function split(id: string, direction: 'row' | 'col', children: Node[], ratios: number[]): Split {
  return { type: 'split', id, direction, children, ratios };
}

/** A `RestoredWorkspace` (the in-memory entry shape persistence rebuilds). */
function entry(
  id: string,
  name: string,
  ws: Workspace,
  registry: Record<string, { program: string; cwd: string | null }>
): RestoredWorkspace {
  return { id, name, ws, registry };
}

// A two-pane row workspace: leaves L1/L2 -> panes p1/p2.
function rowWorkspace(): Workspace {
  return {
    version: 1,
    root: split('S1', 'row', [leaf('L1', 'p1'), leaf('L2', 'p2')], [0.5, 0.5]),
    focusedId: 'L1'
  };
}

// ---------------------------------------------------------------------------
// Serialize Workspace Layout And Session Registry
// ---------------------------------------------------------------------------

describe('Serialize Workspace Layout And Session Registry', () => {
  it('Layout tree and registry serialized to JSON', () => {
    const ws = rowWorkspace();
    const state = serializeState(
      [entry('ws-1', 'Session 1', ws, { p1: { program: 'claude', cwd: '/a' }, p2: { program: '/bin/zsh', cwd: '/b' } })],
      'ws-1'
    );

    // Round-trips through JSON without loss.
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as PersistedState;

    expect(parsed.version).toBe(PERSIST_VERSION);
    expect(parsed.activeWorkspaceId).toBe('ws-1');
    expect(parsed.workspaces).toHaveLength(1);

    const w = parsed.workspaces[0];
    expect(w.id).toBe('ws-1');
    expect(w.name).toBe('Session 1');
    // The recursive tree node is present with direction/children/ratios + focusedId.
    expect(w.tree.focusedId).toBe('L1');
    const root = w.tree.root as Split;
    expect(root.type).toBe('split');
    expect(root.direction).toBe('row');
    expect(root.ratios).toEqual([0.5, 0.5]);
    expect(root.children.map((c) => (c as Leaf).paneId)).toEqual(['p1', 'p2']);

    // A registry entry exists for every paneId referenced by a Leaf.
    expect(Object.keys(w.registry).sort()).toEqual(['p1', 'p2']);
    // The serialized registry carries {program, cwd} (+ optional projectId /
    // sessionId) — other live junk (pid, args, buffers) is dropped.
    // No sessionId in the in-memory entry here, so none in the serialized output.
    expect(w.registry.p1).toEqual({ program: 'claude', cwd: '/a' });
    expect(w.registry.p2).toEqual({ program: '/bin/zsh', cwd: '/b' });
  });

  it('sessionId persisted for claude panes and round-trips', () => {
    const ws = rowWorkspace(); // p1 (claude), p2 (shell)
    const reg = {
      p1: { program: 'claude', cwd: '/my-project', sessionId: 'sess-abc-123' },
      p2: { program: '/bin/zsh', cwd: '/my-project' }
    };
    const state = serializeState([entry('ws-1', 'Session 1', ws, reg)], 'ws-1');
    const w = state.workspaces[0];

    // claude pane: sessionId persisted.
    expect(w.registry.p1).toEqual({ program: 'claude', cwd: '/my-project', sessionId: 'sess-abc-123' });
    // shell pane: no sessionId key (omitted, keeps JSON clean).
    expect(w.registry.p2).toEqual({ program: '/bin/zsh', cwd: '/my-project' });
    expect(w.registry.p2.sessionId).toBeUndefined();

    // Round-trip through restoreState: the persisted sessionId is preserved and
    // resume:true is set so the pane spawns with `--resume <sessionId>`.
    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    const rp1 = restored.workspaces[0].registry.p1;
    expect(rp1.sessionId).toBe('sess-abc-123');
    expect(rp1.resume).toBe(true);

    // A pane without a persisted sessionId (shell or older state) has no resume.
    const rp2 = restored.workspaces[0].registry.p2;
    expect(rp2.sessionId).toBeUndefined();
    expect(rp2.resume).toBeUndefined();
  });

  it('Live process state is not serialized', () => {
    const ws = freshWorkspace('p1', ids('n'));
    // The in-memory registry may carry extra live junk; serialization records
    // ONLY {program, cwd} — never pid/args/process output.
    const liveRegistry = {
      p1: { program: 'claude', cwd: '/proj', pid: 4242, args: ['--foo'], buffer: 'live output' }
    } as unknown as Record<string, { program: string; cwd: string | null }>;

    const state = serializeState([entry('ws-1', 'S', ws, liveRegistry)], 'ws-1');
    const recorded = state.workspaces[0].registry.p1;

    const recordedAny = recorded as unknown as Record<string, unknown>;
    expect(Object.keys(recorded).sort()).toEqual(['cwd', 'program']);
    expect(recorded).toEqual({ program: 'claude', cwd: '/proj' });
    expect(recordedAny.pid).toBeUndefined();
    expect(recordedAny.args).toBeUndefined();
    expect(recordedAny.buffer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Debounced And On-Quit Persistence Writes
// ---------------------------------------------------------------------------

describe('Debounced And On-Quit Persistence Writes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('Rapid mutations coalesce into one write', () => {
    const writes: number[] = [];
    let n = 0;
    const d = new Debouncer(() => writes.push(++n), 250);

    // Five rapid mutations within the debounce window.
    d.schedule();
    vi.advanceTimersByTime(50);
    d.schedule();
    vi.advanceTimersByTime(50);
    d.schedule();
    vi.advanceTimersByTime(50);
    d.schedule();
    vi.advanceTimersByTime(50);
    d.schedule();

    // Nothing has fired yet (each schedule reset the timer).
    expect(writes).toEqual([]);

    // Let the interval fully elapse: exactly ONE coalesced write.
    vi.advanceTimersByTime(250);
    expect(writes).toEqual([1]);

    // No trailing duplicate after more time passes.
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual([1]);
  });

  it('Pending state flushed on quit', () => {
    const writes: string[] = [];
    const d = new Debouncer(() => writes.push('write'), 250);

    d.schedule();
    vi.advanceTimersByTime(100); // still pending, timer not elapsed

    // Quit arrives while a write is pending -> flush forces it synchronously.
    expect(d.pending()).toBe(true);
    d.flush();
    expect(writes).toEqual(['write']);
    expect(d.pending()).toBe(false);

    // The original (now-cancelled) timer must NOT fire a second write.
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual(['write']);
  });

  it('flush is a no-op when nothing is pending', () => {
    const writes: string[] = [];
    const d = new Debouncer(() => writes.push('write'), 250);
    d.flush();
    expect(writes).toEqual([]);
    expect(d.pending()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Restore With Invariant Validation
// ---------------------------------------------------------------------------

describe('Restore With Invariant Validation', () => {
  it('Valid layout restored', () => {
    const state: PersistedState = {
      version: PERSIST_VERSION,
      activeWorkspaceId: 'ws-1',
      workspaces: [
        {
          id: 'ws-1',
          name: 'Session 1',
          tree: rowWorkspace(),
          registry: { p1: { program: 'claude', cwd: '/a' }, p2: { program: '/bin/zsh', cwd: '/b' } }
        }
      ]
    };

    const restored = restoreState(JSON.stringify(state), ids('fresh'));

    expect(restored.activeWorkspaceId).toBe('ws-1');
    expect(restored.workspaces).toHaveLength(1);
    const w = restored.workspaces[0];
    expect(w.id).toBe('ws-1');
    expect(w.name).toBe('Session 1');
    // The tree was rebuilt and focusedId applied.
    expect(w.ws.focusedId).toBe('L1');
    expect((w.ws.root as Split).type).toBe('split');
    expect(w.registry.p1.program).toBe('claude');
    expect(w.registry.p1.cwd).toBe('/a');
    expect(typeof w.registry.p1.sessionId).toBe('string');
  });

  it('Ratios normalized on restore', () => {
    // A structurally valid split whose ratios do not sum to 1.
    const drifted: Workspace = {
      version: 1,
      root: split('S1', 'row', [leaf('L1', 'p1'), leaf('L2', 'p2')], [3, 1]),
      focusedId: 'L1'
    };
    const state: PersistedState = {
      version: PERSIST_VERSION,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'S', tree: drifted, registry: { p1: { program: 'claude', cwd: null }, p2: { program: 'claude', cwd: null } } }]
    };

    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    const root = restored.workspaces[0].ws.root as Split;
    const sum = root.ratios.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(root.ratios[0]).toBeCloseTo(0.75, 9);
    expect(root.ratios[1]).toBeCloseTo(0.25, 9);
  });

  it('Invariant violation is treated as invalid', () => {
    // A split with a single child is an invariant violation; validateTree
    // (via migrate) collapses it, so the corrupt SPLIT is never rebuilt — the
    // surviving tree is just the lone leaf. We assert restore did NOT keep the
    // invalid 1-child split structure.
    const invalid = {
      version: 1,
      root: { type: 'split', id: 'S1', direction: 'row', children: [leaf('L1', 'p1')], ratios: [1] },
      focusedId: 'L1'
    } as unknown as Workspace;
    const state: PersistedState = {
      version: PERSIST_VERSION,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'S', tree: invalid, registry: { p1: { program: 'claude', cwd: null } } }]
    };

    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    // The 1-child split is gone; the workspace is a single valid leaf.
    expect(restored.workspaces[0].ws.root.type).toBe('leaf');
    expect((restored.workspaces[0].ws.root as Leaf).paneId).toBe('p1');
  });

  it('focusedId pointing at no leaf is treated as invalid and repaired', () => {
    const badFocus: Workspace = {
      version: 1,
      root: split('S1', 'row', [leaf('L1', 'p1'), leaf('L2', 'p2')], [0.5, 0.5]),
      focusedId: 'does-not-exist'
    };
    const state: PersistedState = {
      version: PERSIST_VERSION,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'S', tree: badFocus, registry: { p1: { program: 'claude', cwd: null }, p2: { program: 'claude', cwd: null } } }]
    };
    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    // validateTree repoints focus to the first leaf.
    expect(restored.workspaces[0].ws.focusedId).toBe('L1');
  });
});

// ---------------------------------------------------------------------------
// Version-Keyed Migration
// ---------------------------------------------------------------------------

describe('Version-Keyed Migration', () => {
  it('Older version migrated forward', () => {
    // A per-workspace tree written in the pre-versioned v0 shape (`tree`/`focus`
    // instead of `root`/`focusedId`). migrate() lifts it forward to v1.
    const v0Tree = {
      version: 0,
      tree: split('S1', 'row', [leaf('L1', 'p1'), leaf('L2', 'p2')], [0.5, 0.5]),
      focus: 'L2'
    };
    const state = {
      version: PERSIST_VERSION,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'S', tree: v0Tree, registry: { p1: { program: 'claude', cwd: null }, p2: { program: 'claude', cwd: null } } }]
    };

    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    const w = restored.workspaces[0];
    expect(w.ws.version).toBe(1);
    expect(w.ws.focusedId).toBe('L2');
    expect((w.ws.root as Split).type).toBe('split');
  });

  it('Unmigratable version is rejected', () => {
    // A future per-workspace tree version with no migration path. The WHOLE
    // restore falls back to a fresh single-pane claude workspace (never crash).
    const future = { version: 999, root: leaf('L1', 'p1'), focusedId: 'L1' };
    const state = {
      version: PERSIST_VERSION,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'S', tree: future, registry: { p1: { program: 'claude', cwd: null } } }]
    };

    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    expectFreshClaudeWorkspace(restored);
  });
});

// ---------------------------------------------------------------------------
// PTY Re-Spawn With Shell And Cwd Only
// ---------------------------------------------------------------------------

describe('PTY Re-Spawn With Shell And Cwd Only', () => {
  it('One PTY re-spawned per leaf', () => {
    const wsA = rowWorkspace(); // p1, p2
    const wsB: Workspace = {
      version: 1,
      root: leaf('L3', 'p3'),
      focusedId: 'L3'
    };
    const workspaces = [
      entry('ws-1', 'A', wsA, { p1: { program: 'claude', cwd: '/a' }, p2: { program: '/bin/zsh', cwd: '/b' } }),
      entry('ws-2', 'B', wsB, { p3: { program: 'claude', cwd: '/c' } })
    ];

    const calls: { paneId: string; program: string; cwd: string | null }[] = [];
    const spawn = (paneId: string, s: { program: string; cwd: string | null }) =>
      calls.push({ paneId, program: s.program, cwd: s.cwd });

    respawnLeaves(workspaces, spawn);

    // Exactly one spawn per leaf, each with the saved program + cwd.
    expect(calls).toHaveLength(3);
    const byPane = Object.fromEntries(calls.map((c) => [c.paneId, c]));
    expect(byPane.p1).toEqual({ paneId: 'p1', program: 'claude', cwd: '/a' });
    expect(byPane.p2).toEqual({ paneId: 'p2', program: '/bin/zsh', cwd: '/b' });
    expect(byPane.p3).toEqual({ paneId: 'p3', program: 'claude', cwd: '/c' });
  });

  it('Live process state not resurrected', () => {
    // The prior session ran `claude`; on restore the re-spawned PTY uses the
    // SAVED shell + cwd only — it does not re-run/re-attach to the prior process
    // and carries no pid/args. We assert the spawn fn receives only program+cwd.
    const ws: Workspace = { version: 1, root: leaf('L1', 'p1'), focusedId: 'L1' };
    const workspaces = [
      entry('ws-1', 'S', ws, {
        p1: { program: '/bin/zsh', cwd: '/proj' }
      })
    ];

    const received: Record<string, unknown>[] = [];
    respawnLeaves(workspaces, (_paneId, s) => received.push({ ...s }));

    expect(received).toHaveLength(1);
    // Only program + cwd reach the spawner; no process id / args / buffer.
    expect(Object.keys(received[0]).sort()).toEqual(['cwd', 'program']);
    expect(received[0]).toEqual({ program: '/bin/zsh', cwd: '/proj' });
  });
});

// ---------------------------------------------------------------------------
// Graceful Fallback On Corrupt State
// ---------------------------------------------------------------------------

describe('Graceful Fallback On Corrupt State', () => {
  it('Corrupt JSON falls back to fresh workspace', () => {
    const restored = restoreState('{ not valid json ]', ids('fresh'));
    expectFreshClaudeWorkspace(restored);
  });

  it('Missing layout file falls back to fresh workspace', () => {
    // A missing file is represented as null/empty raw input.
    expectFreshClaudeWorkspace(restoreState(null, ids('fresh')));
    expectFreshClaudeWorkspace(restoreState('', ids('fresh')));
  });

  it('Empty workspace list restores to no workspaces (no fabricated agent)', () => {
    // An explicitly-empty saved layout (the user closed every agent) stays empty,
    // rather than fabricating a fresh agent the user didn't ask for.
    const state = { version: PERSIST_VERSION, activeWorkspaceId: '', workspaces: [] };
    const restored = restoreState(JSON.stringify(state), ids('fresh'));
    expect(restored.workspaces).toHaveLength(0);
    expect(restored.activeWorkspaceId).toBe('');
  });

  it('Wrong-shape top-level object falls back to fresh workspace', () => {
    expectFreshClaudeWorkspace(restoreState(JSON.stringify({ foo: 'bar' }), ids('fresh')));
    expectFreshClaudeWorkspace(restoreState(JSON.stringify(42), ids('fresh')));
    expectFreshClaudeWorkspace(restoreState(JSON.stringify(null), ids('fresh')));
  });
});

/**
 * Assert the restored state is exactly one fresh single-pane `claude` workspace:
 * one leaf, focusedId on that leaf, registry program=claude, and it's active.
 */
function expectFreshClaudeWorkspace(restored: {
  workspaces: RestoredWorkspace[];
  activeWorkspaceId: string;
}) {
  expect(restored.workspaces).toHaveLength(1);
  const w = restored.workspaces[0];
  expect(restored.activeWorkspaceId).toBe(w.id);
  expect(w.ws.root.type).toBe('leaf');
  const paneId = (w.ws.root as Leaf).paneId;
  expect(w.ws.focusedId).toBe(w.ws.root.id);
  expect(w.registry[paneId].program).toBe('claude');
}
