// PURE rollup for the two-row usage dashboard (Milestone 3, design D3 / section
// 4.3). Given the live `pane_id -> snapshot` map (plus the focused pane id and
// "now"), it derives the two view-models the `UsageBar` renders:
//
//   - TOP row: one per-session card view-model (model, context_pct, task,
//     live/idle) for every snapshot.
//   - BOTTOM row: the account summary — the NEWEST `rate_limits` across all
//     snapshots (account-global, so we take the single freshest by `ts`), the
//     SUMMED `cost` across panes (null contributions skipped, never zero-breaking
//     the sum), and the FOCUSED pane's git status.
//
// Framework-free (no Svelte/Tauri imports) so it is trivially unit-tested. The
// `UsageBar` component is the thin reactive wrapper that calls `rollup(...)` and
// renders the result. Every "missing" value rolls up to `null`, NEVER `NaN`.

import type { GitStatus, Snapshot, SnapshotMap } from './snapshots.svelte';

/** Default heartbeat staleness: a card is "idle" once its `ts` is older than this. */
export const IDLE_AFTER_SECONDS = 10;

/** One rate-limit window (5h or 7d), normalized from the opaque `rate_limits` object. */
export interface RateWindow {
  /** Percent of the window consumed, 0..100, or null when absent/unparseable. */
  usedPct: number | null;
  /** Unix seconds when the window resets, or null when absent. */
  resetsAt: number | null;
}

/** The bottom-row account summary view-model. */
export interface AccountSummary {
  /** Account-wide 5-hour rate-limit window (null fields when absent). */
  fiveHour: RateWindow;
  /** Account-wide 7-day rate-limit window (null fields when absent). */
  sevenDay: RateWindow;
  /** Whether ANY rate-limit data was present in the newest snapshot. */
  hasRateLimits: boolean;
  /** Summed cost in USD across all panes (present numeric contributions only),
   *  or null when NO pane reported a cost. Never NaN. */
  totalCost: number | null;
  /** The focused pane's git status, or null when unknown. */
  git: GitStatus | null;
}

/** One top-row per-session card view-model. */
export interface SessionCard {
  /** The stable pane id (the snapshot key) — used to focus the pane on click. */
  paneId: string;
  /** Display model name, or null when unknown. */
  model: string | null;
  /** Context window usage 0..100, or null when unknown (render empty bar). */
  contextPct: number | null;
  /** The detected in-progress task, or null. */
  task: string | null;
  /** True while the snapshot heartbeat is fresh; false once stale (idle). */
  live: boolean;
  /** The snapshot's heartbeat timestamp (unix seconds). */
  ts: number;
}

/** The whole dashboard view-model: top-row cards + bottom-row account summary. */
export interface Rollup {
  cards: SessionCard[];
  account: AccountSummary;
}

/** Coerce to a finite number in [0, 100] (or any finite number for resets_at),
 *  else null. Guards against NaN/strings/Infinity from the opaque payload. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Pull one rate-limit window (e.g. `five_hour`) out of the opaque rate_limits
 *  object, reading only `used_percentage` + `resets_at`. Any shape drift → nulls. */
function readWindow(rateLimits: Record<string, unknown> | null, key: string): RateWindow {
  const empty: RateWindow = { usedPct: null, resetsAt: null };
  if (!rateLimits || typeof rateLimits !== 'object') return empty;
  const win = (rateLimits as Record<string, unknown>)[key];
  if (!win || typeof win !== 'object') return empty;
  const w = win as Record<string, unknown>;
  return {
    usedPct: finiteOrNull(w.used_percentage),
    resetsAt: finiteOrNull(w.resets_at)
  };
}

/**
 * The single newest snapshot by `ts`, or null when the map is empty. Ties resolve
 * to whichever was encountered first; `ts` is unique enough in practice (and the
 * account rate_limits are identical across panes anyway, so ties don't matter).
 */
function newest(snaps: Snapshot[]): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snaps) {
    if (best === null || s.ts > best.ts) best = s;
  }
  return best;
}

/**
 * Build the bottom-row account summary from all snapshots + the focused pane git.
 *
 *  - rate limits: from the SINGLE newest snapshot's `rate_limits` (account-global,
 *    so the freshest reading wins); absent → null windows + `hasRateLimits:false`.
 *  - cost: SUM of every present numeric `cost`; null contributions are skipped
 *    (treated as "missing", not zero). If NO pane reported a cost → null (not 0),
 *    so the UI can show an empty state rather than a misleading $0.00.
 *  - git: the focused pane's git, passed through (null when unknown).
 */
export function accountSummary(map: SnapshotMap, focusedGit: GitStatus | null): AccountSummary {
  const snaps = Object.values(map);

  const fresh = newest(snaps);
  const rateLimits = fresh ? fresh.rate_limits : null;
  const fiveHour = readWindow(rateLimits, 'five_hour');
  const sevenDay = readWindow(rateLimits, 'seven_day');
  const hasRateLimits =
    fiveHour.usedPct !== null ||
    fiveHour.resetsAt !== null ||
    sevenDay.usedPct !== null ||
    sevenDay.resetsAt !== null;

  let totalCost: number | null = null;
  for (const s of snaps) {
    const c = finiteOrNull(s.cost);
    if (c !== null) totalCost = (totalCost ?? 0) + c;
  }

  return {
    fiveHour,
    sevenDay,
    hasRateLimits,
    totalCost,
    git: focusedGit
  };
}

/**
 * Build one per-session card from a snapshot. `live` is true while the heartbeat
 * is fresh — i.e. `nowSeconds - ts <= idleAfter`. A snapshot with a non-finite or
 * future `ts` is treated as live (fresh) rather than throwing.
 */
export function sessionCard(
  snapshot: Snapshot,
  nowSeconds: number,
  idleAfter: number = IDLE_AFTER_SECONDS
): SessionCard {
  const ts = finiteOrNull(snapshot.ts) ?? 0;
  const age = nowSeconds - ts;
  const live = age <= idleAfter;
  return {
    paneId: snapshot.pane_id,
    model: snapshot.model ?? null,
    contextPct: finiteOrNull(snapshot.context_pct),
    task: snapshot.task ?? null,
    live,
    ts
  };
}

/**
 * The whole dashboard rollup: top-row cards (one per snapshot, ordered by pane id
 * for a stable layout) + the bottom-row account summary. Pure: reads the map and
 * the inputs, returns fresh view-models, mutates nothing.
 *
 * @param map          the live pane_id -> snapshot map
 * @param focusedPane  the focused pane id (its git fills the bottom row); may be null
 * @param nowSeconds   "now" in unix seconds, for the live/idle heartbeat
 * @param idleAfter    staleness threshold in seconds (default IDLE_AFTER_SECONDS)
 */
export function rollup(
  map: SnapshotMap,
  focusedPane: string | null,
  nowSeconds: number,
  idleAfter: number = IDLE_AFTER_SECONDS
): Rollup {
  const focusedSnap = focusedPane ? map[focusedPane] : undefined;
  const focusedGit = focusedSnap ? (focusedSnap.git ?? null) : null;

  const cards = Object.values(map)
    .slice()
    .sort((a, b) => a.pane_id.localeCompare(b.pane_id))
    .map((s) => sessionCard(s, nowSeconds, idleAfter));

  return {
    cards,
    account: accountSummary(map, focusedGit)
  };
}
