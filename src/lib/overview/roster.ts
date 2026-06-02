// PURE roster view-model for the agent-overview surface (Stage 1, tasks.md 10.1;
// design D3/D7). Given the live `pane_id -> snapshot` map plus a framework-free
// projection of the workspace list, it produces ONE `AgentRow` per app (claude)
// pane: its name/cwd, model, current task, context %, cost, and a live/idle/
// needs-attention status derived from the snapshot heartbeat + activity.
//
// Framework-free (no Svelte/Tauri imports) so it is trivially unit-tested. The
// Overview component is the thin reactive wrapper that projects the workspace
// store's `WorkspaceEntry[]` into `RosterWorkspace[]`, calls `buildRoster(...)`,
// and renders the rows. Every "missing" value rolls up to `null`, NEVER `NaN`.

import { IDLE_AFTER_SECONDS } from '../usage/rollup';
import type { Snapshot, SnapshotMap } from '../usage/snapshots.svelte';

/** The live/idle/needs-attention status of an agent. */
export type AgentStatus = 'live' | 'idle' | 'needs-attention';

/** One pane in a workspace, as the roster needs it (framework-free projection). */
export interface RosterPane {
  /** The frontend pane id (== `AGENT_DESKTOP_PANE`, the snapshot key). */
  paneId: string;
  /** The pane's working directory, or null (inherits the app cwd). */
  cwd: string | null;
  /** Whether this pane runs an app (claude) agent. Non-app (shell) panes are
   *  NOT agents and never appear in the roster. */
  isApp: boolean;
}

/** One workspace, projected to exactly what the roster reads. */
export interface RosterWorkspace {
  /** The workspace id (the row's `workspaceId`, used to activate it on click). */
  id: string;
  /** The workspace's display name (the rail label); may be empty. */
  name: string;
  /** This workspace's panes, in tree order. */
  panes: RosterPane[];
}

/** One agent in the overview roster — the view-model the Overview renders. */
export interface AgentRow {
  /** The stable pane id (snapshot key) — used to focus/message the pane. */
  paneId: string;
  /** The owning workspace id — used to activate that workspace on navigate. */
  workspaceId: string;
  /** Display name: the workspace name, else a short cwd basename, else paneId. */
  name: string;
  /** The agent's working directory, or null. */
  cwd: string | null;
  /** Display model name from the snapshot, or null when unknown. */
  model: string | null;
  /** The current in-progress task (`activeForm`), or null. */
  task: string | null;
  /** Context-window usage 0..100, or null when unknown. */
  contextPct: number | null;
  /** Total session cost in USD, or null when unknown. */
  cost: number | null;
  /** Derived live/idle/needs-attention status. */
  status: AgentStatus;
}

/** Coerce to a finite number, else null (guards NaN/Infinity/strings). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Whether a task string is a real, non-blank in-progress task. */
function hasTask(task: string | null | undefined): boolean {
  return typeof task === 'string' && task.trim().length > 0;
}

/**
 * PURE status heuristic for one agent, from its latest snapshot + "now":
 *
 *  - `live`            — the heartbeat is FRESH (`now - ts <= idleAfter`) AND the
 *                        agent has a non-empty in-progress task (it is working).
 *  - `needs-attention` — the heartbeat is FRESH but there is NO in-progress task
 *                        (the agent is idling at a prompt / waiting on the user /
 *                        asking a question — it wants your attention).
 *  - `idle`            — the heartbeat is STALE (older than `idleAfter`), OR there
 *                        is no snapshot at all yet (a freshly-launched pane whose
 *                        wrapper has not written a heartbeat).
 *
 * A snapshot with a non-finite `ts` is treated as fresh (ts=0 only matters
 * relative to `now`, so callers pass a real `now`). Never throws.
 */
export function statusOf(
  snapshot: Snapshot | undefined,
  nowSeconds: number,
  idleAfter: number = IDLE_AFTER_SECONDS
): AgentStatus {
  if (!snapshot) return 'idle';
  const ts = finiteOrNull(snapshot.ts) ?? 0;
  const fresh = nowSeconds - ts <= idleAfter;
  if (!fresh) return 'idle';
  return hasTask(snapshot.task) ? 'live' : 'needs-attention';
}

/** The last path segment of a cwd (e.g. `/home/u/parser` -> `parser`), or null. */
function shortCwd(cwd: string | null): string | null {
  if (!cwd) return null;
  const trimmed = cwd.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}

/** The display name: workspace name, else short cwd, else the pane id. */
function displayName(wsName: string, cwd: string | null, paneId: string): string {
  const name = wsName.trim();
  if (name.length > 0) return name;
  return shortCwd(cwd) ?? paneId;
}

/**
 * Build one `AgentRow` for an app pane from its (possibly absent) snapshot. The
 * name/cwd come from the workspace projection; the model/task/context/cost from
 * the snapshot; the status from the heartbeat heuristic.
 */
function rowFor(
  workspaceId: string,
  wsName: string,
  pane: RosterPane,
  snapshot: Snapshot | undefined,
  nowSeconds: number,
  idleAfter: number
): AgentRow {
  return {
    paneId: pane.paneId,
    workspaceId,
    name: displayName(wsName, pane.cwd, pane.paneId),
    cwd: pane.cwd,
    model: snapshot?.model ?? null,
    task: snapshot?.task ?? null,
    contextPct: finiteOrNull(snapshot?.context_pct),
    cost: finiteOrNull(snapshot?.cost),
    status: statusOf(snapshot, nowSeconds, idleAfter)
  };
}

/**
 * The whole roster: ONE `AgentRow` per app pane across every workspace, in
 * workspace-then-pane (tree) order. Non-app (shell) panes are skipped entirely.
 * An app pane with no snapshot yet still rosters (its status is `idle` until a
 * heartbeat arrives), so a freshly-launched agent is never silently dropped.
 *
 * Pure: reads the map + workspaces + `now`, returns fresh rows, mutates nothing.
 *
 * @param map         the live pane_id -> snapshot map
 * @param workspaces  the framework-free workspace projection
 * @param nowSeconds  "now" in unix seconds, for the live/idle heartbeat
 * @param idleAfter   staleness threshold in seconds (default IDLE_AFTER_SECONDS)
 */
export function buildRoster(
  map: SnapshotMap,
  workspaces: RosterWorkspace[],
  nowSeconds: number,
  idleAfter: number = IDLE_AFTER_SECONDS
): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const ws of workspaces) {
    for (const pane of ws.panes) {
      if (!pane.isApp) continue;
      rows.push(rowFor(ws.id, ws.name, pane, map[pane.paneId], nowSeconds, idleAfter));
    }
  }
  return rows;
}
