import { describe, expect, it } from 'vitest';
import {
  buildRoster,
  deriveStatus,
  WORKING_WINDOW_MS,
  type PaneRuntime,
  type RosterWorkspace,
  type RuntimeMap
} from './roster';
import type { Snapshot, SnapshotMap } from '../usage/snapshots.svelte';

// Tests for the PURE roster view-model (Stage 1 of agent-overview). The `it(...)`
// titles are the EXACT `#### Scenario:` names from the agent-overview spec
// (Requirements: Agent Roster Overview) so the scenario-coverage gate maps each
// to this unit test. Visual rendering / click-to-navigate is MANUAL (live window).

function snap(paneId: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    pane_id: paneId,
    session_id: null,
    model: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1,
    ...over
  };
}

function mapOf(...snaps: Snapshot[]): SnapshotMap {
  const m: SnapshotMap = {};
  for (const s of snaps) m[s.pane_id] = s;
  return m;
}

/** A runtime entry for a pane (PTY activity + process state). */
function rt(paneId: string, over: Partial<PaneRuntime> = {}): [string, PaneRuntime] {
  return [paneId, { lastOutputAt: null, exited: false, exitCode: null, ...over }];
}

function runtimeOf(...entries: [string, PaneRuntime][]): RuntimeMap {
  const m: RuntimeMap = {};
  for (const [id, r] of entries) m[id] = r;
  return m;
}

/** One workspace with a single app (claude) pane. */
function ws(
  id: string,
  name: string,
  panes: { paneId: string; cwd: string | null; isApp?: boolean }[]
): RosterWorkspace {
  return {
    id,
    name,
    panes: panes.map((p) => ({
      paneId: p.paneId,
      cwd: p.cwd,
      isApp: p.isApp ?? true
    }))
  };
}

describe('roster — Agent Roster Overview', () => {
  it('Roster reflects running agents', () => {
    const now = 1_000_000; // epoch ms
    const map = mapOf(
      snap('pane-a', {
        model: 'claude-opus',
        task: 'Refactoring the parser',
        context_pct: 42,
        cost: 1.25
      }),
      snap('pane-b', {
        model: 'claude-sonnet',
        task: 'Writing tests',
        context_pct: 13,
        cost: 0.4
      })
    );
    // pane-a is streaming output right now (working); pane-b last spoke a while
    // ago and is waiting on the user.
    const runtime = runtimeOf(
      rt('pane-a', { lastOutputAt: now - 200 }),
      rt('pane-b', { lastOutputAt: now - WORKING_WINDOW_MS - 5_000 })
    );
    const workspaces = [
      ws('ws-1', 'Parser', [{ paneId: 'pane-a', cwd: '/home/u/parser' }]),
      ws('ws-2', 'Tests', [{ paneId: 'pane-b', cwd: '/home/u/tests' }])
    ];

    const rows = buildRoster(map, workspaces, runtime, now);

    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.paneId === 'pane-a')!;
    expect(a.workspaceId).toBe('ws-1');
    expect(a.name).toBe('Parser');
    expect(a.cwd).toBe('/home/u/parser');
    expect(a.model).toBe('claude-opus');
    expect(a.task).toBe('Refactoring the parser');
    expect(a.contextPct).toBe(42);
    expect(a.cost).toBe(1.25);
    expect(a.status).toBe('working');

    const b = rows.find((r) => r.paneId === 'pane-b')!;
    expect(b.model).toBe('claude-sonnet');
    expect(b.task).toBe('Writing tests');
    expect(b.contextPct).toBe(13);
    expect(b.cost).toBe(0.4);
    expect(b.status).toBe('waiting');
  });

  // Only panes flagged as app (claude) sessions are agents; a plain shell pane in
  // the same workspace is not rostered. A pane with no runtime yet still rosters
  // (status derived from the missing activity), so the roster never silently drops
  // a freshly-launched agent — but a non-app pane never appears at all.
  it('Only app panes become agent rows', () => {
    const now = 1_000_000;
    const map = mapOf(snap('pane-app', { task: 'Building' }));
    const workspaces = [
      ws('ws-1', 'Mixed', [
        { paneId: 'pane-app', cwd: '/x', isApp: true },
        { paneId: 'pane-shell', cwd: '/x', isApp: false }
      ])
    ];

    const rows = buildRoster(map, workspaces, {}, now);

    expect(rows.map((r) => r.paneId)).toEqual(['pane-app']);
  });

  // Name falls back to a short cwd basename when the workspace name is empty.
  it('Name falls back to short cwd', () => {
    const now = 1_000_000;
    const map = mapOf(snap('pane-a'));
    const workspaces = [
      ws('ws-1', '', [{ paneId: 'pane-a', cwd: '/home/u/projects/agent-desktop' }])
    ];

    const rows = buildRoster(map, workspaces, {}, now);

    expect(rows[0].name).toBe('agent-desktop');
  });
});

describe('roster — Agent status heuristic', () => {
  it('Agent status reflects working, waiting, finished, and errored', () => {
    const now = 1_000_000; // epoch ms

    // Alive + recent PTY output (claude is streaming) => working.
    expect(deriveStatus({ lastOutputAt: now - 100, exited: false, exitCode: null }, now)).toBe(
      'working'
    );
    // Output exactly at the working window is still working (<= window).
    expect(
      deriveStatus({ lastOutputAt: now - WORKING_WINDOW_MS, exited: false, exitCode: null }, now)
    ).toBe('working');
    // Alive but no output recently (claude is quiet at the prompt) => waiting on
    // YOU — the visually prominent "needs input" state.
    expect(
      deriveStatus(
        { lastOutputAt: now - WORKING_WINDOW_MS - 1, exited: false, exitCode: null },
        now
      )
    ).toBe('waiting');
    // Alive + just spawned, no output yet => treated as working (starting up), so
    // a launching agent never flashes idle.
    expect(deriveStatus({ lastOutputAt: null, exited: false, exitCode: null }, now)).toBe(
      'working'
    );

    // Process exited cleanly (code 0 or unknown) => finished.
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: 0 }, now)).toBe(
      'finished'
    );
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: null }, now)).toBe(
      'finished'
    );
    // Process exited non-zero => errored, regardless of prior activity.
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: 1 }, now)).toBe('error');
    expect(deriveStatus({ lastOutputAt: now - 50, exited: true, exitCode: 137 }, now)).toBe(
      'error'
    );

    // No runtime at all (pane not wired yet) => idle.
    expect(deriveStatus(undefined, now)).toBe('idle');
  });
});
