// PURE view-model for the per-pane task BADGE (Milestone 4, design D7;
// requirement "Surface Task Per Pane"). A leaf pane shows a subtle top-right pill
// with the session's current task + a live/idle dot, driven straight from that
// pane's snapshot in the `snapshots` store (the SAME snapshot the dashboard card
// reads, so badge and card never disagree). For app-launched sessions the task is
// already in the snapshot the watcher pushes — the badge does NOT independently
// watch `~/.claude/tasks/`.
//
// Framework-free (no Svelte/Tauri imports) so it is trivially unit-tested. The
// `TaskBadge.svelte` component is the thin reactive shell that calls this and
// renders the pill (hiding entirely when this returns null).

import type { Snapshot } from './snapshots.svelte';
import { IDLE_AFTER_SECONDS } from './rollup';

/** The badge view-model: what the pill renders. */
export interface TaskBadgeView {
  /** The non-empty task label (the snapshot's `task`, trimmed). */
  label: string;
  /** True while the snapshot heartbeat is fresh; false once stale (idle). */
  live: boolean;
}

/** Coerce to a finite number, else null (guards a non-finite/absent `ts`). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Derive the per-pane task badge from a snapshot, or `null` when there is no task
 * to show (no snapshot, or a null/empty/whitespace-only `task`). Returning null is
 * the signal for the component to render NOTHING — the badge must never show an
 * empty pill or a dash.
 *
 * `live` mirrors the dashboard card's heartbeat math (`rollup.sessionCard`): the
 * session is live while `nowSeconds - ts <= idleAfter`. A non-finite/future `ts`
 * is treated as live (fresh) rather than throwing, matching the card.
 *
 * @param snapshot   the pane's snapshot (or undefined when none has arrived)
 * @param nowSeconds "now" in unix seconds, for the live/idle heartbeat
 * @param idleAfter  staleness threshold in seconds (default IDLE_AFTER_SECONDS)
 */
export function taskBadge(
  snapshot: Snapshot | undefined,
  nowSeconds: number,
  idleAfter: number = IDLE_AFTER_SECONDS
): TaskBadgeView | null {
  if (!snapshot) return null;
  const label = typeof snapshot.task === 'string' ? snapshot.task.trim() : '';
  if (!label) return null;

  const ts = finiteOrNull(snapshot.ts) ?? 0;
  const live = nowSeconds - ts <= idleAfter;
  return { label, live };
}
