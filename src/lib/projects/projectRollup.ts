// PURE view-model for the project panel (projects capability): given the agent
// roster rows + the project list, compute each project's live agent COUNT and
// whether it NEEDS ATTENTION (any of its agents is waiting/errored), plus the
// filter that the panel's selection applies to the roster. Framework-free and
// unit-tested; the ProjectPanel component is the thin reactive shell.

import { needsAttention, type AgentRow } from '../overview/roster';
import type { Project } from './projects';

/** The special filter value meaning "every agent, regardless of project". */
export const ALL = 'all' as const;
/** The special filter value meaning "agents with no project assigned". */
export const UNASSIGNED = '__unassigned__' as const;

/** A project filter selection: ALL, UNASSIGNED, or a concrete project id. */
export type ProjectFilter = typeof ALL | typeof UNASSIGNED | string;

/** One project's live rollup, as the panel renders it. */
export interface ProjectCount {
  project: Project;
  /** Number of agents currently assigned to this project. */
  count: number;
  /** Whether any of this project's agents is waiting on you / errored. */
  attn: boolean;
}

/**
 * Per-project counts + attention flags, in the given project order. Agents whose
 * `projectId` doesn't match any known project are ignored here (they surface via
 * the UNASSIGNED bucket / count instead).
 */
export function projectCounts(
  rows: ReadonlyArray<AgentRow>,
  projects: ReadonlyArray<Project>
): ProjectCount[] {
  return projects.map((project) => {
    const mine = rows.filter((r) => r.projectId === project.id);
    return {
      project,
      count: mine.length,
      attn: mine.some(needsAttention)
    };
  });
}

/** How many agents have no project assigned (registry entry without a projectId). */
export function unassignedCount(rows: ReadonlyArray<AgentRow>): number {
  return rows.filter((r) => r.projectId === null).length;
}

/**
 * Apply a panel selection to the roster:
 *  - ALL         -> every row
 *  - UNASSIGNED  -> rows with no project
 *  - <projectId> -> rows assigned to that project
 *
 * Pure: returns a new array, never mutates the input.
 */
export function filterRowsByProject(
  rows: ReadonlyArray<AgentRow>,
  selected: ProjectFilter
): AgentRow[] {
  if (selected === ALL) return [...rows];
  if (selected === UNASSIGNED) return rows.filter((r) => r.projectId === null);
  return rows.filter((r) => r.projectId === selected);
}

/**
 * The panel's filter options, top-to-bottom, for keyboard nav: ALL, then each
 * project (in list order), then UNASSIGNED iff any agent is unassigned. Matches
 * the panel's render order so `⌘⇧↑`/`⌘⇧↓` walks exactly what's on screen.
 */
export function filterOrder(
  projects: ReadonlyArray<Project>,
  hasUnassigned: boolean
): ProjectFilter[] {
  const order: ProjectFilter[] = [ALL, ...projects.map((p) => p.id)];
  if (hasUnassigned) order.push(UNASSIGNED);
  return order;
}

/**
 * Step from `current` by `dir` (+1 next / -1 previous) through `order`, clamped
 * at both ends (no wrap — mirrors the agent nav). If `current` isn't in `order`,
 * forward starts at the first entry and backward at the last.
 */
export function stepFilter(
  order: ReadonlyArray<ProjectFilter>,
  current: ProjectFilter,
  dir: 1 | -1
): ProjectFilter {
  if (order.length === 0) return current;
  const i = order.indexOf(current);
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1];
  const next = Math.min(order.length - 1, Math.max(0, i + dir));
  return order[next];
}
