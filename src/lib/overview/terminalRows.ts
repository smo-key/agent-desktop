// PURE builders for the PLAIN-TERMINAL rows the inbox lists alongside sessions in
// the combined terminals placement (tasks-panel: "Terminals can be combined into
// the sessions list"; agent-status-derivation: "Terminal rows derive status from
// the foreground job"). Framework-free — the project-terminals store's DATA is
// projected into `TerminalRowInput`s (`collectTerminalRowInputs`) and then into
// `AgentRow`s (`buildTerminalRows`) with a status from `deriveTerminalStatus`, so
// every rule is unit-tested without the Svelte store or a PTY.

import type { BareTerminal, TaskRuntime } from '../tasks/projectTasks.svelte';
import type { TaskDef, TasksByProject } from '../tasks/projectTasks';
import {
  WORKING_WINDOW_MS,
  deriveStatus,
  type AgentRow,
  type AgentStatus,
  type PaneRuntime,
  type RuntimeMap
} from './roster';

/** One terminal to list: the projection of a task runtime or a bare shell. */
export interface TerminalRowInput {
  /** The store key behind the row (`task:<defId>` / `bare:<bareId>`). */
  key: string;
  /** The live pane id (the row's identity; the runtime + terminal-handle key). */
  paneId: string;
  kind: 'task' | 'bare';
  projectId: string;
  /** The row title: a task's display name, or "Terminal" for a bare shell. */
  name: string;
  /** The row sub-line: a task's command, or a shell's live title / cwd. */
  summary: string | null;
  cwd: string | null;
  running: boolean;
  exitCode: number | null;
}

/** The store data the projection reads (a plain-data view of `projectTasks`). */
export interface TerminalSource {
  byProject: TasksByProject;
  runtime: Record<string, TaskRuntime>;
  bareByProject: Record<string, BareTerminal[]>;
  /** Project id → folder path (for a shell's cwd). */
  projectPaths: Record<string, string>;
}

/**
 * Every ACTIVE terminal across all projects, in project → task → bare order:
 * terminal-kind task defs that have a runtime (running, failed, or kept open) and
 * every bare shell. Idle (or auto-closed) tasks have no runtime and are skipped —
 * they live in the Tasks launcher. Pure.
 */
export function collectTerminalRowInputs(src: TerminalSource): TerminalRowInput[] {
  const out: TerminalRowInput[] = [];
  const projectIds = new Set<string>([
    ...Object.keys(src.byProject),
    ...Object.keys(src.bareByProject)
  ]);
  for (const pid of projectIds) {
    const path = src.projectPaths[pid] ?? null;
    for (const def of src.byProject[pid] ?? []) {
      if (def.kind !== 'terminal') continue;
      const rt = src.runtime[def.id];
      if (!rt) continue;
      out.push({
        key: `task:${def.id}`,
        paneId: rt.paneId,
        kind: 'task',
        projectId: pid,
        name: rt.title || def.name,
        summary: taskSummary(def),
        cwd: def.cwd ?? path,
        running: rt.running,
        exitCode: rt.exitCode
      });
    }
    for (const bare of src.bareByProject[pid] ?? []) {
      out.push({
        key: `bare:${bare.id}`,
        paneId: bare.paneId,
        kind: 'bare',
        projectId: pid,
        name: 'Terminal',
        summary: bare.title || path || null,
        cwd: path,
        running: bare.running,
        exitCode: bare.exitCode
      });
    }
  }
  return out;
}

function taskSummary(def: TaskDef): string | null {
  const cmd = typeof def.command === 'string' ? def.command.trim() : '';
  return cmd === '' ? null : cmd;
}

/**
 * The status of a terminal row (agent-status-derivation: "Terminal rows derive
 * status from the foreground job"):
 *  - not running          → `error` on a non-zero exit, else `finished`
 *                           (clean exit kept open, or stopped by the user);
 *  - a running TASK       → `working` (its process IS the work);
 *  - a running BARE shell → `working` when the probe saw a foreground job,
 *                           `waiting` when it saw an idle prompt, else (unknown)
 *                           the agents' output-activity fallback.
 * Pure; never throws.
 */
export function deriveTerminalStatus(
  input: Pick<TerminalRowInput, 'kind' | 'running' | 'exitCode'>,
  runtime: PaneRuntime | undefined,
  nowMs: number
): AgentStatus {
  if (!input.running) {
    return input.exitCode != null && input.exitCode !== 0 ? 'error' : 'finished';
  }
  if (input.kind === 'task') return 'working';
  const fg = runtime?.foregroundBusy;
  if (fg === true) return 'working';
  if (fg === false) return 'waiting';
  return deriveStatus(runtime, nowMs, WORKING_WINDOW_MS, runtime?.lastStatus);
}

/** One `AgentRow` per terminal input, statused from the live runtime map. Pure. */
export function buildTerminalRows(
  inputs: ReadonlyArray<TerminalRowInput>,
  runtime: RuntimeMap,
  nowMs: number
): AgentRow[] {
  return inputs.map((t) => {
    const rt = runtime[t.paneId];
    return {
      paneId: t.paneId,
      workspaceId: '',
      name: t.name,
      cwd: t.cwd,
      model: null,
      modelId: null,
      worktree: null,
      task: null,
      summary: t.summary,
      question: null,
      questions: null,
      currentAction: null,
      contextPct: null,
      cost: null,
      // The row's timestamp is the terminal's START time, not its last output chunk:
      // date-ordered rosters would otherwise re-sort a streaming terminal every tick.
      lastTs: rt?.spawnedAt != null ? Math.floor(rt.spawnedAt / 1000) : null,
      status: deriveTerminalStatus(t, rt, nowMs),
      projectId: t.projectId,
      specialist: null,
      closed: false,
      paused: false,
      pausedCount: null,
      preview: false,
      previewCount: null,
      everPrompted: false,
      kind: 'terminal',
      terminalKind: t.kind,
      terminalKey: t.key,
      running: t.running
    };
  });
}

/** Whether a roster row is a plain-terminal row. */
export function isTerminalRow(row: Pick<AgentRow, 'kind'>): boolean {
  return row.kind === 'terminal';
}

/** The focus-header actions for a terminal row: Kill while running / Close once
 *  stopped, plus Restart for a task (a bare shell is not restartable). */
export function terminalFocusActions(
  row: Pick<AgentRow, 'running' | 'terminalKind'>
): { primary: 'Kill' | 'Close'; restart: boolean } {
  return { primary: row.running ? 'Kill' : 'Close', restart: row.terminalKind === 'task' };
}

/**
 * The lane order to PERSIST: `order` with every terminal row id removed. Terminal
 * ids are per-process (they never survive a restart) so they keep their
 * in-session slot but are never written. Returns `prev` itself when the result is
 * identical to it, so a caller can skip a redundant settings write. Pure.
 */
export function persistedLaneOrder<L extends string>(
  order: Record<L, string[]>,
  terminalIds: ReadonlySet<string>,
  lanes: ReadonlyArray<L>,
  prev: Record<L, string[]>
): Record<L, string[]> {
  const out = {} as Record<L, string[]>;
  let same = true;
  for (const lane of lanes) {
    const ids = order[lane].filter((id) => !terminalIds.has(id));
    out[lane] = ids;
    const p = prev[lane] ?? [];
    if (ids.length !== p.length || ids.some((id, i) => id !== p[i])) same = false;
  }
  return same ? prev : out;
}
/**
 * The DURABLE title key of a terminal row, or null when it has none
 * (`tasks-panel`: "Terminal rows are titled like sessions"). A task terminal's
 * `task:<defId>` is stable across restarts, so a custom title survives one; a bare
 * shell's `bare:<id>` is per-process — persisting under it would strand the entry
 * forever — so it gets null and its title lives only for that process. Pure.
 */
export function terminalTitleKey(row: Pick<AgentRow, 'terminalKind' | 'terminalKey'>): string | null {
  return row.terminalKind === 'task' ? (row.terminalKey ?? null) : null;
}

/**
 * The title refs for a set of terminal rows: the durable key plus what the shell
 * has reported doing (from `activityOf`, the live terminal handle). Only BARE
 * shells carry activity — a task terminal's command already IS its name, and
 * titling it would spend a model call restating it — so a task row's `activity`
 * is always null and it is never sent to the model. Pure.
 */
export function terminalTitleRefs(
  rows: ReadonlyArray<AgentRow>,
  activityOf: (paneId: string) => string | null
): { paneId: string; key: string | null; activity: string | null }[] {
  return rows.filter(isTerminalRow).map((r) => ({
    paneId: r.paneId,
    key: terminalTitleKey(r),
    activity: r.terminalKind === 'bare' ? activityOf(r.paneId) : null
  }));
}
