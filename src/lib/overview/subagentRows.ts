// PURE view-model for the nested SUBAGENT ROWS shown under a parent agent in the
// Inbox (spec: agent-overview / Surface Subagents). The Inbox passes a session's
// `Subagent[]` (from `subagents.forSession(sessionId)`) through `liveSubagents` to
// drop any that have EXITED (`isSubagentExited`), then `groupSubagentsByPhase` to
// render workflow → phase groups, and labels each row's "duration alive" with
// `formatDurationAlive`. Framework-free (no Svelte/Tauri imports) so it is trivially
// unit-tested; the Inbox is thin glue over these functions.

import type { Subagent } from './subagents.svelte';

/** A workflow's subagents, bucketed by phase. `phases` is ordered by `phaseIndex`. */
export interface WorkflowGroup {
  /** The workflow run id (`wf_…`), or null for subagents with no workflow id. */
  workflowId: string | null;
  /** This workflow's phase groups, ordered by phase index (unknown index last). */
  phases: PhaseGroup[];
}

/** One phase within a workflow group, holding that phase's subagents in input order. */
export interface PhaseGroup {
  /** The phase title (e.g. `Capabilities`), or null when the row had no phase. */
  phaseTitle: string | null;
  /** The phase ordinal used for ordering, or null when unknown. */
  phaseIndex: number | null;
  /** The subagents in this phase, in their input (parser) order. */
  subagents: Subagent[];
}

/**
 * PURE: whether a subagent has EXITED — a known terminal state, either success
 * (`done`/`completed`/`success`) or failure (`error`/`failed`). Case-insensitive.
 * A live (`running`/`queued`), unknown, or absent status is NOT exited, so a
 * subagent is never hidden on uncertainty. Mirrors the Inbox `subStatusClass`
 * terminal vocabulary (the `done` + `error` buckets).
 */
export function isSubagentExited(status?: string | null): boolean {
  const s = (status ?? '').toLowerCase();
  return (
    s === 'done' || s === 'completed' || s === 'success' || s === 'error' || s === 'failed'
  );
}

/**
 * PURE: keep only the subagents that are still ALIVE (not exited), preserving input
 * order. The Inbox runs a session's subagents through this before grouping so a
 * subagent drops off the nested rows the moment it terminates — only in-flight
 * subagents stay visible. Never mutates input.
 */
export function liveSubagents(subs: Subagent[]): Subagent[] {
  return subs.filter((s) => !isSubagentExited(s.status));
}

/**
 * PURE: bucket a session's subagents by workflow run, then by phase. Workflow groups
 * keep first-seen order (the parser already sorts by workflow id then id); within a
 * workflow, phase groups are ordered by `phaseIndex` ascending with unknown-index
 * phases last, and subagents keep their input order within a phase. A subagent with
 * no `workflowId` falls into a single trailing `workflowId: null` group, and one with
 * no `phaseTitle` into a `phaseTitle: null` phase — never dropped. Never mutates input.
 */
export function groupSubagentsByPhase(subs: Subagent[]): WorkflowGroup[] {
  const order: (string | null)[] = [];
  const byWorkflow = new Map<string | null, Subagent[]>();
  for (const s of subs) {
    const wf = s.workflowId ?? null;
    if (!byWorkflow.has(wf)) {
      byWorkflow.set(wf, []);
      order.push(wf);
    }
    byWorkflow.get(wf)!.push(s);
  }
  return order.map((workflowId) => ({
    workflowId,
    phases: groupPhases(byWorkflow.get(workflowId)!),
  }));
}

/** Bucket one workflow's subagents into phase groups, ordered by phase index. */
function groupPhases(subs: Subagent[]): PhaseGroup[] {
  const order: (string | null)[] = [];
  const byPhase = new Map<string | null, Subagent[]>();
  const indexOf = new Map<string | null, number | null>();
  for (const s of subs) {
    const key = s.phaseTitle ?? null;
    if (!byPhase.has(key)) {
      byPhase.set(key, []);
      order.push(key);
      indexOf.set(key, typeof s.phaseIndex === 'number' ? s.phaseIndex : null);
    }
    byPhase.get(key)!.push(s);
  }
  return order
    .map((key, seen) => ({
      group: {
        phaseTitle: key,
        phaseIndex: indexOf.get(key) ?? null,
        subagents: byPhase.get(key)!,
      } satisfies PhaseGroup,
      seen,
    }))
    // Stable order by phaseIndex asc; unknown (null) index sorts last; ties keep
    // first-seen order.
    .sort((a, b) => {
      const ai = a.group.phaseIndex;
      const bi = b.group.phaseIndex;
      if (ai === null && bi === null) return a.seen - b.seen;
      if (ai === null) return 1;
      if (bi === null) return -1;
      return ai - bi || a.seen - b.seen;
    })
    .map((x) => x.group);
}

/**
 * PURE: a compact "duration alive" label for a subagent. A FINISHED subagent (its
 * `durationMs` recorded) shows that duration; a still-RUNNING one (a `startedAt` but
 * no final `durationMs`) shows the elapsed time since it started, relative to `nowMs`.
 * Returns an empty string when neither is known. Formats as `1h 3m` / `2m 14s` / `5s`.
 */
export function formatDurationAlive(
  sub: Pick<Subagent, 'durationMs' | 'startedAt'>,
  nowMs: number
): string {
  let ms: number | null = null;
  if (typeof sub.durationMs === 'number' && sub.durationMs >= 0) {
    ms = sub.durationMs;
  } else if (typeof sub.startedAt === 'number') {
    ms = Math.max(0, nowMs - sub.startedAt);
  }
  if (ms === null) return '';
  return formatMs(ms);
}

/** Format a millisecond span as a compact two-unit string (`1h 3m`/`2m 14s`/`5s`). */
function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
