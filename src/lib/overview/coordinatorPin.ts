// PURE, framework-free logic for PINNING the per-project COORDINATOR atop the
// Sessions roster (add-agent-specialists, tasks 10.2–10.4). Given the (already
// project-filtered) roster rows and the ACTIVE project id, it decides what goes in
// the roster's top slot: the live coordinator row (pulled out of the normal lanes
// so it never renders twice), or — when the project has no live coordinator — a
// "Start coordinator" affordance. It also owns the sentinel focus-id the main pane
// recognizes to render the not-started-coordinator Start empty-state.
//
// No Svelte/Tauri/DOM imports, so the load-bearing decisions are unit-tested
// without a live workspace. The Inbox component is the thin reactive wrapper.

import type { AgentLane, AgentRow } from './roster';
import { groupByLane, LANE_ORDER } from './roster';

/** The result of resolving the roster's coordinator top slot for a project. */
export interface CoordinatorPin {
  /** The live coordinator row to pin at the top, or null when none is running. */
  coordinator: AgentRow | null;
  /** The remaining rows (coordinator removed), in their original order, for the
   *  normal lane grouping below the rule. */
  rest: AgentRow[];
  /** Whether to show the "Start coordinator" affordance in the top slot — true when
   *  there is a concrete active project with NO live coordinator. */
  showStart: boolean;
}

/**
 * PURE: a LIVE coordinator is a row whose `role === 'coordinator'` belonging to
 * `projectId`, that is not closed/archived/previewing (a closed coordinator is not
 * the live one — the Start affordance relaunches it). Mirrors the
 * `findCoordinatorPane` invariant but operates on roster rows.
 */
function isLiveCoordinator(row: AgentRow, projectId: string): boolean {
  return (
    row.role === 'coordinator' &&
    (row.projectId ?? null) === projectId &&
    row.closed !== true &&
    row.preview !== true
  );
}

/**
 * PURE: resolve the roster's coordinator top slot.
 *
 * With NO concrete active project (`activeProjectId` null/empty — the "All" /
 * "Unassigned" filter), there is no coordinator to pin and no Start affordance: the
 * roster renders exactly as before (coordinator stays in its lane), so:
 *   `{ coordinator: null, rest: rows, showStart: false }`.
 *
 * With a concrete active project:
 *   - if a live coordinator row exists, it is pinned (`coordinator`) and removed
 *     from `rest`; `showStart` is false.
 *   - otherwise `coordinator` is null, `rest` is unchanged, and `showStart` is true
 *     (the not-started affordance occupies the top slot).
 *
 * The FIRST matching coordinator wins (one-per-project invariant); never throws.
 */
export function resolveCoordinatorPin(
  rows: AgentRow[],
  activeProjectId: string | null
): CoordinatorPin {
  if (typeof activeProjectId !== 'string' || activeProjectId.trim() === '') {
    return { coordinator: null, rest: rows, showStart: false };
  }
  let coordinator: AgentRow | null = null;
  const rest: AgentRow[] = [];
  for (const row of rows) {
    if (coordinator === null && isLiveCoordinator(row, activeProjectId)) {
      coordinator = row;
    } else {
      rest.push(row);
    }
  }
  return { coordinator, rest, showStart: coordinator === null };
}

/** Prefix marking a sentinel focus id for a not-started coordinator's Start state. */
const START_SENTINEL_PREFIX = 'coordinator-start:';

/**
 * PURE: the sentinel focus id for a project's not-started-coordinator Start state.
 * Selecting this (rather than a real pane id) tells the main pane to render the
 * Start empty-state instead of a terminal (task 10.4).
 */
export function coordinatorStartId(projectId: string): string {
  return `${START_SENTINEL_PREFIX}${projectId}`;
}

/**
 * PURE: if `focusId` is a coordinator-start sentinel, the project id it targets;
 * else null. The main pane uses this to switch into the Start empty-state.
 */
export function coordinatorStartProject(focusId: string | null): string | null {
  if (typeof focusId !== 'string' || !focusId.startsWith(START_SENTINEL_PREFIX)) {
    return null;
  }
  const id = focusId.slice(START_SENTINEL_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * One keyboard-cycling step target for the Sessions roster (task 10.8). Either a
 * real pane row (`kind: 'pane'`) or the not-started coordinator's Start sentinel
 * (`kind: 'start'`), so ⌘↑/⌘↓ can step onto the not-started affordance — which has
 * no backing pane — exactly as if it were clicked.
 */
export type CoordinatorNavTarget =
  | { kind: 'pane'; paneId: string }
  | { kind: 'start'; projectId: string };

/**
 * PURE: the ⌘↑/⌘↓ cycling order for the Sessions roster, with the project's
 * COORDINATOR (or, when not started, its Start affordance) FIRST, then the rest in
 * lane order — mirroring the visual order (pinned coordinator/affordance atop the
 * rule, lanes below). This guarantees the coordinator (running OR not-started) is
 * always reachable by keyboard, INCLUDING when it is the only entry in the list.
 *
 * Built from the SAME `resolveCoordinatorPin` decision the render uses, so nav and
 * render never diverge:
 *   - a live pinned coordinator → a `pane` target first, then `pin.rest` by lane.
 *   - a not-started coordinator (concrete active project, no live coordinator) → a
 *     `start` sentinel target first, then all rows by lane.
 *   - no concrete active project (null/empty) → no coordinator slot; just the rows
 *     by lane (the coordinator, if any, stays inline in its lane and is reachable
 *     as a normal `pane` target).
 *
 * `lanes(rows)` flattens rows into the LANE_ORDER the roster renders. Never throws.
 */
export function coordinatorNavOrder(
  rows: AgentRow[],
  activeProjectId: string | null
): CoordinatorNavTarget[] {
  const lanes = (list: AgentRow[]): CoordinatorNavTarget[] => {
    const grouped: Record<AgentLane, AgentRow[]> = groupByLane(list);
    return LANE_ORDER.flatMap((lane) =>
      grouped[lane].map((r) => ({ kind: 'pane', paneId: r.paneId }) as CoordinatorNavTarget)
    );
  };
  const pin = resolveCoordinatorPin(rows, activeProjectId);
  if (pin.coordinator) {
    return [{ kind: 'pane', paneId: pin.coordinator.paneId }, ...lanes(pin.rest)];
  }
  if (
    pin.showStart &&
    typeof activeProjectId === 'string' &&
    activeProjectId.trim() !== ''
  ) {
    return [{ kind: 'start', projectId: activeProjectId }, ...lanes(pin.rest)];
  }
  return lanes(rows);
}
