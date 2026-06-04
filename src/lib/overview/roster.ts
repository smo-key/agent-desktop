// PURE roster view-model for the agent-overview surface (Stage 1, tasks.md 10.1;
// design D3/D7). Given the live `pane_id -> snapshot` map, a framework-free
// projection of the workspace list, and the per-pane RUNTIME state (PTY output
// activity + process exit), it produces ONE `AgentRow` per app (claude) pane: its
// name/cwd, model, current task, context %, cost, and a working/waiting/finished/
// errored status.
//
// Status is derived from the LIVE terminal — not the statusline snapshot. The
// statusline wrapper only writes a snapshot when claude re-renders its status bar,
// which is sparse and stops entirely while claude waits at a prompt, so a
// heartbeat-based status read "idle" almost always. The PTY byte stream, by
// contrast, flows continuously while claude works (its spinner/token output) and
// falls silent the instant it stops — a far truer "is it working" signal — and
// the process exit code distinguishes a clean finish from an error.
//
// Framework-free (no Svelte/Tauri imports) so it is trivially unit-tested. The
// Overview component is the thin reactive wrapper that projects the workspace
// store's `WorkspaceEntry[]` into `RosterWorkspace[]`, feeds the runtime registry
// in, calls `buildRoster(...)`, and renders the rows. Every "missing" value rolls
// up to `null`, NEVER `NaN`.

import type { Snapshot, SnapshotMap } from '../usage/snapshots.svelte';
import type { EventActivity } from './events';

/**
 * An agent's live status, derived from its terminal activity + process state:
 *  - `working`  — the PTY produced output within the working window (streaming).
 *  - `waiting`  — alive but quiet: claude is at the prompt, needing YOUR input.
 *  - `finished` — the process exited cleanly (code 0 / unknown).
 *  - `error`    — the process exited with a non-zero code.
 *  - `idle`     — no runtime info yet (pane not wired).
 */
export type AgentStatus = 'working' | 'waiting' | 'finished' | 'error' | 'idle';

/**
 * The control-room LANE an agent belongs to — the Overview groups the roster into
 * three lanes, ordered top->bottom by how much they need you:
 *  - `attn`   — needs attention: waiting on YOU, or errored (the prominent lane).
 *  - `done`   — completed: the process finished cleanly.
 *  - `flight` — in flight: working on its own, or idle (these need you least).
 */
export type AgentLane = 'attn' | 'done' | 'flight';

/** The lane render order (top -> bottom): needs-attention, in-flight, completed.
 *  Completed sits at the BOTTOM (it needs you least and is collapsed by default). */
export const LANE_ORDER: readonly AgentLane[] = ['attn', 'flight', 'done'];

/** PURE: the lane for a status. waiting/error -> attn, finished -> done, else flight. */
export function laneOf(status: AgentStatus): AgentLane {
  if (status === 'waiting' || status === 'error') return 'attn';
  if (status === 'finished') return 'done';
  return 'flight';
}

/**
 * PURE: partition the roster into its three lanes, preserving the original roster
 * order within each lane. Always returns all three keys (empty arrays when a lane
 * has no agents) so the Overview can decide whether to render each lane.
 */
export function groupByLane(rows: AgentRow[]): Record<AgentLane, AgentRow[]> {
  const grouped: Record<AgentLane, AgentRow[]> = { attn: [], done: [], flight: [] };
  for (const row of rows) grouped[laneOf(row.status)].push(row);
  return grouped;
}

/** Per-pane runtime state captured from the live terminal (framework-free). */
export interface PaneRuntime {
  /** Epoch ms of the most recent PTY output, or null if none seen yet. */
  lastOutputAt: number | null;
  /** Whether the pane's process has exited. */
  exited: boolean;
  /** The process exit code once exited, else null (and null for an unknown code). */
  exitCode: number | null;
}

/** The live `pane_id -> runtime` map the Overview feeds into `buildRoster`. */
export type RuntimeMap = Record<string, PaneRuntime>;

/** One selectable option of a pending `AskUserQuestion` (label + longer help). */
export interface QuestionOption {
  /** The option's short label (what the user picks). */
  label: string;
  /** The option's longer description (may be empty). */
  description: string;
}

/** One pending question of an `AskUserQuestion`: header, prompt, options, mode. */
export interface PendingQuestion {
  /** A short header/label for the question (may be empty). */
  header: string;
  /** The question prompt text. */
  question: string;
  /** Whether more than one option may be selected. */
  multiSelect: boolean;
  /** The selectable options (empty for an open-ended free-text question). */
  options: QuestionOption[];
}

/** Transcript-derived activity for an agent (framework-free shape). */
export interface RowActivity {
  /** The agent's last assistant message, or null. */
  summary?: string | null;
  /** A pending AskUserQuestion the agent is waiting on (compact text), or null. */
  question?: string | null;
  /** The full structured pending question(s) — options the user can answer, or null. */
  questions?: PendingQuestion[] | null;
  /** Context-window usage 0..100 from the transcript, or null. */
  contextPct?: number | null;
}

/** The live `pane_id -> activity` map the Overview feeds into `buildRoster`.
 *  Keyed on the frontend PANE id (the transcript is located from the pane's cwd),
 *  so a row resolves its activity directly with no dependency on the snapshot. */
export type ActivityMap = Record<string, RowActivity>;

/**
 * Output newer than this (ms) counts as "working". It must exceed claude's
 * spinner/token cadence (it re-renders several times a second while working) so
 * an active agent stays `working`, yet be short enough that going quiet flips to
 * `waiting` promptly.
 */
export const WORKING_WINDOW_MS = 2500;

/** One pane in a workspace, as the roster needs it (framework-free projection). */
export interface RosterPane {
  /** The frontend pane id (== `AGENT_DESKTOP_PANE`, the snapshot key). */
  paneId: string;
  /** The pane's working directory, or null (inherits the app cwd). */
  cwd: string | null;
  /** Whether this pane runs an app (claude) agent. Non-app (shell) panes are
   *  NOT agents and never appear in the roster. */
  isApp: boolean;
  /** The project this agent was launched under, or null/undefined if none. */
  projectId?: string | null;
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
  /** The agent's last assistant message (high-level "what it just said"), or null. */
  summary: string | null;
  /** A pending AskUserQuestion the agent is waiting on (compact text), or null. */
  question: string | null;
  /** The full structured pending question(s) the user can answer, or null. */
  questions: PendingQuestion[] | null;
  /** The in-flight tool's label (event-sourced, e.g. `Bash:npm test`), or null. */
  currentAction: string | null;
  /** Context-window usage 0..100, or null when unknown. */
  contextPct: number | null;
  /** Total session cost in USD, or null when unknown. */
  cost: number | null;
  /** Derived live/idle/needs-attention status. */
  status: AgentStatus;
  /** The project this agent belongs to (registry `projectId`), or null if none. */
  projectId: string | null;
}

/** Coerce to a finite number, else null (guards NaN/Infinity/strings). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * PURE status for one agent, from its live runtime state + "now" (epoch ms):
 *
 *  - process exited, non-zero code            → `error`   (crashed / failed)
 *  - process exited, code 0 or unknown        → `finished`(session ended cleanly)
 *  - alive, output within the working window  → `working` (streaming right now)
 *  - alive, output older than the window      → `waiting` (quiet — needs input)
 *  - alive, no output yet                     → `working` (just spawned, starting)
 *  - no runtime at all                        → `idle`    (pane not wired yet)
 *
 * Exit state takes precedence over activity (a dead process is never "working").
 * Never throws.
 */
export function deriveStatus(
  runtime: PaneRuntime | undefined,
  nowMs: number,
  workingWindowMs: number = WORKING_WINDOW_MS
): AgentStatus {
  if (!runtime) return 'idle';
  if (runtime.exited) {
    const code = finiteOrNull(runtime.exitCode);
    return code !== null && code !== 0 ? 'error' : 'finished';
  }
  if (runtime.lastOutputAt === null) return 'working';
  return nowMs - runtime.lastOutputAt <= workingWindowMs ? 'working' : 'waiting';
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
 * Build one `AgentRow` for an app pane. The name/cwd come from the workspace
 * projection; the model/task/context/cost from the (possibly absent) snapshot;
 * the status from the live runtime state (PTY activity + process exit).
 */
function rowFor(
  workspaceId: string,
  wsName: string,
  pane: RosterPane,
  snapshot: Snapshot | undefined,
  runtime: PaneRuntime | undefined,
  activity: RowActivity | undefined,
  event: EventActivity | undefined,
  nowMs: number,
  workingWindowMs: number
): AgentRow {
  // Status precedence: a process exit is AUTHORITATIVE (a dead process is never
  // "working"); otherwise the event-sourced status wins; the PTY-byte heuristic is
  // the fallback only when events haven't determined a status (or none arrived).
  const ptyStatus = deriveStatus(runtime, nowMs, workingWindowMs);
  const status = runtime?.exited ? ptyStatus : event?.status ?? ptyStatus;
  return {
    paneId: pane.paneId,
    workspaceId,
    name: displayName(wsName, pane.cwd, pane.paneId),
    cwd: pane.cwd,
    model: snapshot?.model ?? null,
    task: snapshot?.task ?? null,
    summary: activity?.summary ?? null,
    // The pending question is event-sourced (it rides the PreToolUse event); the
    // transcript sidecar is a fallback for sessions with no event pipeline.
    question: event?.question ?? activity?.question ?? null,
    questions: event?.questions ?? activity?.questions ?? null,
    currentAction: event?.currentAction ?? null,
    // Prefer the transcript-derived context % (decoupled from the statusline
    // snapshot); fall back to the snapshot's when the transcript has no usage yet.
    contextPct: finiteOrNull(activity?.contextPct) ?? finiteOrNull(snapshot?.context_pct),
    cost: finiteOrNull(snapshot?.cost),
    status,
    projectId: pane.projectId ?? null
  };
}

/**
 * The whole roster: ONE `AgentRow` per app pane across every workspace, in
 * workspace-then-pane (tree) order. Non-app (shell) panes are skipped entirely.
 * An app pane with no runtime yet still rosters (status `idle` until its terminal
 * wires up), so a freshly-launched agent is never silently dropped.
 *
 * Pure: reads the maps + workspaces + `now`, returns fresh rows, mutates nothing.
 *
 * @param map         the live pane_id -> snapshot map (model/task/context/cost)
 * @param workspaces  the framework-free workspace projection
 * @param runtime     the live pane_id -> runtime map (PTY activity + exit), for status
 * @param nowMs       "now" in epoch ms, for the output-activity window
 * @param activity    the live session_id -> transcript activity map (summary/question)
 * @param workingWindowMs  activity window in ms (default WORKING_WINDOW_MS)
 */
export function buildRoster(
  map: SnapshotMap,
  workspaces: RosterWorkspace[],
  runtime: RuntimeMap,
  nowMs: number,
  activity: ActivityMap = {},
  workingWindowMs: number = WORKING_WINDOW_MS,
  eventActivity: Record<string, EventActivity> = {}
): AgentRow[] {
  const rows: AgentRow[] = [];
  for (const ws of workspaces) {
    for (const pane of ws.panes) {
      if (!pane.isApp) continue;
      // Both activity maps are keyed on the pane id (its transcript/events are
      // located from the cwd / the app-stamped pane env).
      const act = activity[pane.paneId];
      rows.push(
        rowFor(
          ws.id,
          ws.name,
          pane,
          map[pane.paneId],
          runtime[pane.paneId],
          act,
          eventActivity[pane.paneId],
          nowMs,
          workingWindowMs
        )
      );
    }
  }
  return rows;
}
