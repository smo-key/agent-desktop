import { describe, expect, it } from 'vitest';
import {
  resolveCoordinatorPin,
  coordinatorStartId,
  coordinatorStartProject,
  coordinatorNavOrder
} from './coordinatorPin';
import type { AgentRow } from './roster';

/** Minimal AgentRow factory — only the fields the pin logic reads matter. */
function row(partial: Partial<AgentRow> & { paneId: string }): AgentRow {
  return {
    workspaceId: 'ws',
    name: partial.paneId,
    cwd: null,
    model: null,
    modelId: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    lastTs: null,
    status: 'working',
    projectId: null,
    ...partial
  };
}

describe('resolveCoordinatorPin (tasks 10.2–10.3)', () => {
  it('pins the live coordinator and removes it from the rest, in order', () => {
    const rows = [
      row({ paneId: 'a', projectId: 'P' }),
      row({ paneId: 'coord', projectId: 'P', role: 'coordinator' }),
      row({ paneId: 'b', projectId: 'P' })
    ];
    const pin = resolveCoordinatorPin(rows, 'P');
    expect(pin.coordinator?.paneId).toBe('coord');
    expect(pin.rest.map((r) => r.paneId)).toEqual(['a', 'b']);
    expect(pin.showStart).toBe(false);
  });

  it('shows the Start affordance when the active project has no coordinator', () => {
    const rows = [row({ paneId: 'a', projectId: 'P' })];
    const pin = resolveCoordinatorPin(rows, 'P');
    expect(pin.coordinator).toBeNull();
    expect(pin.rest.map((r) => r.paneId)).toEqual(['a']);
    expect(pin.showStart).toBe(true);
  });

  it('ignores a coordinator from a DIFFERENT project (shows Start for the active one)', () => {
    const rows = [row({ paneId: 'coordX', projectId: 'X', role: 'coordinator' })];
    const pin = resolveCoordinatorPin(rows, 'P');
    expect(pin.coordinator).toBeNull();
    expect(pin.showStart).toBe(true);
    // The other project's coordinator still rosters normally.
    expect(pin.rest.map((r) => r.paneId)).toEqual(['coordX']);
  });

  it('does not pin a CLOSED/previewed coordinator — shows Start instead', () => {
    const closed = [row({ paneId: 'coord', projectId: 'P', role: 'coordinator', closed: true })];
    expect(resolveCoordinatorPin(closed, 'P').showStart).toBe(true);
    expect(resolveCoordinatorPin(closed, 'P').coordinator).toBeNull();
    const previewing = [
      row({ paneId: 'coord', projectId: 'P', role: 'coordinator', preview: true })
    ];
    expect(resolveCoordinatorPin(previewing, 'P').showStart).toBe(true);
  });

  it('no concrete active project → no pin, no Start, rows untouched', () => {
    const rows = [row({ paneId: 'coord', projectId: 'P', role: 'coordinator' })];
    for (const none of [null, '', '   ']) {
      const pin = resolveCoordinatorPin(rows, none as string | null);
      expect(pin.coordinator).toBeNull();
      expect(pin.showStart).toBe(false);
      expect(pin.rest).toBe(rows);
    }
  });

  it('shows Start with an EMPTY roster for a concrete project (task 10.6)', () => {
    // With no sessions at all, a concrete project still gets the Start affordance in
    // the top slot (the roster pins coordinator/affordance + rule above the
    // "No sessions yet" empty state).
    const pin = resolveCoordinatorPin([], 'P');
    expect(pin.coordinator).toBeNull();
    expect(pin.showStart).toBe(true);
    expect(pin.rest).toEqual([]);
  });

  it('pins a live coordinator that is the ONLY row (task 10.6)', () => {
    // The coordinator pinned at top with no other sessions: it is pulled out and the
    // rest is empty, so only the pinned coordinator + rule render (empty state below).
    const rows = [row({ paneId: 'coord', projectId: 'P', role: 'coordinator' })];
    const pin = resolveCoordinatorPin(rows, 'P');
    expect(pin.coordinator?.paneId).toBe('coord');
    expect(pin.rest).toEqual([]);
    expect(pin.showStart).toBe(false);
  });

  it('rest is empty whenever there are no NON-coordinator sessions (task 10.10)', () => {
    // The "No sessions yet" empty state keys off `rest` being empty — the lane rows
    // AFTER the pinned coordinator is removed — NOT the total row count. So it must
    // be empty when the only session is a RUNNING pinned coordinator, exactly as it
    // is for the not-started affordance (showStart) and the wholly-empty roster.
    // running coordinator only → pinned, rest empty (empty box shows below the rule)
    const running = resolveCoordinatorPin(
      [row({ paneId: 'coord', projectId: 'P', role: 'coordinator' })],
      'P'
    );
    expect(running.coordinator?.paneId).toBe('coord');
    expect(running.rest).toEqual([]);
    // not-started affordance, no sessions → rest empty (empty box shows below)
    expect(resolveCoordinatorPin([], 'P').rest).toEqual([]);
    // running coordinator + ANOTHER session → rest non-empty (NO empty box)
    const withOther = resolveCoordinatorPin(
      [
        row({ paneId: 'coord', projectId: 'P', role: 'coordinator' }),
        row({ paneId: 'a', projectId: 'P' })
      ],
      'P'
    );
    expect(withOther.rest.map((r) => r.paneId)).toEqual(['a']);
    // No concrete project (All / Unassigned): coordinator not pinned, so rest === rows
    // — the empty-state gate (rest empty) still matches "zero rows" as before.
    expect(
      resolveCoordinatorPin(
        [row({ paneId: 'coord', projectId: 'P', role: 'coordinator' })],
        null
      ).rest.length
    ).toBe(1);
    expect(resolveCoordinatorPin([], null).rest).toEqual([]);
  });

  it('pins only the FIRST coordinator when state momentarily has two', () => {
    const rows = [
      row({ paneId: 'coord1', projectId: 'P', role: 'coordinator' }),
      row({ paneId: 'coord2', projectId: 'P', role: 'coordinator' })
    ];
    const pin = resolveCoordinatorPin(rows, 'P');
    expect(pin.coordinator?.paneId).toBe('coord1');
    // The stray second coordinator stays in the rest (rendered in its lane).
    expect(pin.rest.map((r) => r.paneId)).toEqual(['coord2']);
  });
});

describe('coordinatorNavOrder — ⌘↑/↓ cycling with the coordinator (task 10.8)', () => {
  it('puts the LIVE pinned coordinator FIRST, then the rest in lane order', () => {
    const rows = [
      row({ paneId: 'a', projectId: 'P' }), // flight
      row({ paneId: 'coord', projectId: 'P', role: 'coordinator' }), // pinned first
      row({ paneId: 'w', projectId: 'P', status: 'waiting' }) // attn lane (before flight)
    ];
    const order = coordinatorNavOrder(rows, 'P');
    expect(order).toEqual([
      { kind: 'pane', paneId: 'coord' },
      { kind: 'pane', paneId: 'w' }, // attn lane first among the rest
      { kind: 'pane', paneId: 'a' } // flight lane after
    ]);
  });

  it('puts the not-started START SENTINEL first when no live coordinator', () => {
    const rows = [row({ paneId: 'a', projectId: 'P' })];
    const order = coordinatorNavOrder(rows, 'P');
    expect(order).toEqual([
      { kind: 'start', projectId: 'P' },
      { kind: 'pane', paneId: 'a' }
    ]);
  });

  it('reaches the LIVE coordinator when it is the ONLY entry', () => {
    const rows = [row({ paneId: 'coord', projectId: 'P', role: 'coordinator' })];
    expect(coordinatorNavOrder(rows, 'P')).toEqual([{ kind: 'pane', paneId: 'coord' }]);
  });

  it('reaches the not-started SENTINEL when it is the ONLY entry (empty roster)', () => {
    // No sessions at all for a concrete project → the sole step target is the Start
    // sentinel, so ⌘↑/↓ still lands on the not-started affordance.
    expect(coordinatorNavOrder([], 'P')).toEqual([{ kind: 'start', projectId: 'P' }]);
  });

  it('with NO concrete active project, the coordinator stays inline (no sentinel)', () => {
    const rows = [
      row({ paneId: 'coord', projectId: 'P', role: 'coordinator' }),
      row({ paneId: 'a', projectId: 'P' })
    ];
    for (const none of [null, '', '   ']) {
      const order = coordinatorNavOrder(rows, none as string | null);
      // No `start` target; both rows are reachable as plain panes in lane order.
      expect(order.every((t) => t.kind === 'pane')).toBe(true);
      expect(order).toEqual([
        { kind: 'pane', paneId: 'coord' },
        { kind: 'pane', paneId: 'a' }
      ]);
    }
  });

  it('does not pin a CLOSED coordinator — offers the Start sentinel instead', () => {
    const rows = [row({ paneId: 'coord', projectId: 'P', role: 'coordinator', closed: true })];
    const order = coordinatorNavOrder(rows, 'P');
    // The closed coordinator rosters in its lane (done); the sentinel leads.
    expect(order[0]).toEqual({ kind: 'start', projectId: 'P' });
    expect(order).toContainEqual({ kind: 'pane', paneId: 'coord' });
  });

  it('an empty roster with NO concrete project yields no targets', () => {
    expect(coordinatorNavOrder([], null)).toEqual([]);
  });
});

describe('coordinator-start sentinel (task 10.4)', () => {
  it('round-trips a project id through the sentinel', () => {
    const id = coordinatorStartId('proj-123');
    expect(coordinatorStartProject(id)).toBe('proj-123');
  });

  it('returns null for a non-sentinel focus id', () => {
    expect(coordinatorStartProject('pane-abc')).toBeNull();
    expect(coordinatorStartProject(null)).toBeNull();
    expect(coordinatorStartProject('coordinator-start:')).toBeNull();
  });
});
