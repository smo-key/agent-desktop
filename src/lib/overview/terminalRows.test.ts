import { describe, expect, it } from 'vitest';
import {
  buildTerminalRows,
  collectTerminalRowInputs,
  deriveTerminalStatus,
  isTerminalRow,
  terminalFocusActions,
  type TerminalSource
} from './terminalRows';
import { IDLE_GRACE_MS, WORKING_WINDOW_MS, type PaneRuntime } from './roster';
import { filterRowsByProject } from '$lib/projects/projectRollup';

// Titles are the EXACT `#### Scenario:` names (tasks-panel: "Terminals can be
// combined into the sessions list"; agent-status-derivation: "Terminal rows derive
// status from the foreground job") so the coverage gate maps them here. The live
// teleport / row rendering is DOM-bound and confirmed in-app.

function source(over: Partial<TerminalSource> = {}): TerminalSource {
  return {
    byProject: {
      A: [
        { id: 't1', name: 'dev server', kind: 'terminal', command: 'npm run dev', cwd: null },
        { id: 't-idle', name: 'idle task', kind: 'terminal', command: 'make', cwd: null },
        { id: 'ag', name: 'agent task', kind: 'agent', command: null, cwd: null, prompt: 'go' }
      ],
      B: [{ id: 't2', name: 'tests', kind: 'terminal', command: 'yarn test', cwd: '/b/sub' }]
    },
    runtime: {
      t1: { paneId: 'tpane-1', running: true, exitCode: null, title: '' },
      t2: { paneId: 'tpane-2', running: false, exitCode: 1, title: 'yarn' }
    },
    bareByProject: {
      A: [{ id: 'b1', projectId: 'A', paneId: 'tpane-3', running: true, exitCode: null, title: '' }]
    },
    projectPaths: { A: '/a', B: '/b' },
    ...over
  };
}

const rt = (over: Partial<PaneRuntime> = {}): PaneRuntime => ({
  lastOutputAt: null,
  exited: false,
  exitCode: null,
  ...over
});

describe('terminal rows — Terminals can be combined into the sessions list', () => {
  it('Combined placement lists terminals as rows', () => {
    const inputs = collectTerminalRowInputs(source());
    expect(inputs.map((i) => i.key)).toEqual(['task:t1', 'bare:b1', 'task:t2']);
    // Idle tasks (no runtime) and agent-kind tasks are not terminals.
    expect(inputs.some((i) => i.key === 'task:t-idle' || i.key === 'task:ag')).toBe(false);
    const rows = buildTerminalRows(inputs, {}, 1000);
    expect(rows.map((r) => [r.paneId, r.projectId, r.name, r.kind])).toEqual([
      ['tpane-1', 'A', 'dev server', 'terminal'],
      ['tpane-3', 'A', 'Terminal', 'terminal'],
      ['tpane-2', 'B', 'yarn', 'terminal']
    ]);
    // The sub-line carries the command / shell context; cwd resolves to the project.
    expect(rows[0].summary).toBe('npm run dev');
    expect(rows[0].cwd).toBe('/a');
    expect(rows[1].summary).toBe('/a');
    expect(rows[2].cwd).toBe('/b/sub');
    expect(rows[2].terminalKey).toBe('task:t2');
    expect(rows[2].running).toBe(false);
    expect(rows.every((r) => isTerminalRow(r) && r.workspaceId === '' && !r.closed)).toBe(true);
    // A live title relabels a task row; lastTs comes from the pane's last output.
    const titled = buildTerminalRows(inputs, { 'tpane-1': rt({ lastOutputAt: 5_000 }) }, 6_000);
    expect(titled[0].lastTs).toBe(5);
    expect(rows[0].lastTs).toBeNull();
    const withTitle = collectTerminalRowInputs(
      source({ runtime: { t1: { paneId: 'tpane-1', running: true, exitCode: null, title: 'vite' } } })
    );
    expect(withTitle[0].name).toBe('vite');
  });

  it('Terminal rows follow the project filter', () => {
    const rows = buildTerminalRows(collectTerminalRowInputs(source()), {}, 1000);
    expect(filterRowsByProject(rows, 'A').map((r) => r.paneId)).toEqual(['tpane-1', 'tpane-3']);
    expect(filterRowsByProject(rows, 'B').map((r) => r.paneId)).toEqual(['tpane-2']);
    expect(filterRowsByProject(rows, 'all')).toHaveLength(3);
    // A terminal always belongs to a project, so none is "unassigned".
    expect(filterRowsByProject(rows, 'unassigned')).toHaveLength(0);
  });

  it('Terminal row focus actions track its state', () => {
    expect(terminalFocusActions({ running: true, terminalKind: 'task' })).toEqual({
      primary: 'Kill',
      restart: true
    });
    expect(terminalFocusActions({ running: false, terminalKind: 'task' })).toEqual({
      primary: 'Close',
      restart: true
    });
    expect(terminalFocusActions({ running: true, terminalKind: 'bare' })).toEqual({
      primary: 'Kill',
      restart: false
    });
    expect(terminalFocusActions({ running: false, terminalKind: 'bare' })).toEqual({
      primary: 'Close',
      restart: false
    });
  });
});

describe('deriveTerminalStatus — Terminal rows derive status from the foreground job', () => {
  const now = 100_000;

  it('A running task terminal reads In flight', () => {
    expect(deriveTerminalStatus({ kind: 'task', running: true, exitCode: null }, undefined, now)).toBe(
      'working'
    );
    // Even a long-quiet task process is work (its process IS the job).
    expect(
      deriveTerminalStatus(
        { kind: 'task', running: true, exitCode: null },
        rt({ lastOutputAt: now - IDLE_GRACE_MS * 5, foregroundBusy: false }),
        now
      )
    ).toBe('working');
  });

  it('A shell running a foreground job reads In flight', () => {
    expect(
      deriveTerminalStatus(
        { kind: 'bare', running: true, exitCode: null },
        rt({ lastOutputAt: now - IDLE_GRACE_MS * 5, foregroundBusy: true }),
        now
      )
    ).toBe('working');
  });

  it('An idle shell prompt reads Needs input', () => {
    // A recent redraw does not rescue an idle prompt: the probe is authoritative.
    expect(
      deriveTerminalStatus(
        { kind: 'bare', running: true, exitCode: null },
        rt({ lastOutputAt: now, foregroundBusy: false }),
        now
      )
    ).toBe('waiting');
  });

  it('A failed terminal reads Needs input as an error', () => {
    expect(deriveTerminalStatus({ kind: 'task', running: false, exitCode: 1 }, undefined, now)).toBe(
      'error'
    );
    expect(deriveTerminalStatus({ kind: 'bare', running: false, exitCode: 130 }, undefined, now)).toBe(
      'error'
    );
  });

  it('A stopped terminal reads finished', () => {
    expect(deriveTerminalStatus({ kind: 'task', running: false, exitCode: 0 }, undefined, now)).toBe(
      'finished'
    );
    // Stopped by the user: no exit code recorded.
    expect(deriveTerminalStatus({ kind: 'task', running: false, exitCode: null }, undefined, now)).toBe(
      'finished'
    );
    expect(deriveTerminalStatus({ kind: 'bare', running: false, exitCode: 0 }, undefined, now)).toBe(
      'finished'
    );
  });

  it('Unknown foreground state falls back to output activity', () => {
    const shell = { kind: 'bare' as const, running: true, exitCode: null };
    // Recent output → working; quiet → waiting; never probed → same as agents.
    expect(deriveTerminalStatus(shell, rt({ lastOutputAt: now - WORKING_WINDOW_MS / 2 }), now)).toBe(
      'working'
    );
    expect(deriveTerminalStatus(shell, rt({ lastOutputAt: now - IDLE_GRACE_MS * 2 }), now)).toBe(
      'waiting'
    );
    expect(
      deriveTerminalStatus(shell, rt({ lastOutputAt: now - IDLE_GRACE_MS * 2, foregroundBusy: null }), now)
    ).toBe('waiting');
    // Just spawned, no output yet → working; no runtime entry at all → idle.
    expect(deriveTerminalStatus(shell, rt(), now)).toBe('working');
    expect(deriveTerminalStatus(shell, undefined, now)).toBe('idle');
  });
});
