// PURE roster SECTIONING for the sessions panel (agent-roster-display: "The
// roster grouping is user-selectable"). Given the roster rows ALREADY in view
// order — `pinRowsToTop(orderRowsByLane(rows, laneOrder), pinned)`, i.e. pinned
// first, then lane-grouped + within-lane-ordered — and the user's grouping mode,
// this produces the ordered list of SECTIONS the Inbox renders:
//
//   1. `pinned`   — the pinned rows, in pin order (always first);
//   2. the mode body over the remaining LIVE rows:
//        `status` → one `lane` section per attn / flight / paused (LANE_ORDER),
//                   preserving the incoming (lane-ordered) order — byte-for-byte
//                   the classic rendering;
//        `date`   → one `date` section per Today / Yesterday / Last 7 days /
//                   Older bucket of the row's last activity, newest first inside;
//        `none`   → a single headerless `flat` section, newest activity first;
//   3. `archived` — the `done`-lane rows, incoming (newest-first) order (always last).
//
// Empty sections are dropped, so the Inbox never renders a header over nothing.
// The Inbox derives its `viewRows` by flattening these sections, so the attention
// queue, auto-advance, and keyboard stepping always agree with what is on screen.
// Framework-free (no Svelte/Tauri imports); unit-tested in grouping.test.ts.

import { LANE_ORDER, laneForRow, type AgentLane, type AgentRow } from './roster';
import type { GroupingMode } from '../settings/sessionGrouping.svelte';

export type { GroupingMode };

/** The date buckets, in display (newest → oldest) order. */
export const DATE_BUCKETS = ['today', 'yesterday', 'week', 'older'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

/** Section header text per date bucket. */
export const DATE_BUCKET_TITLES: Record<DateBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  older: 'Older'
};

/** The section kinds the Inbox renders; `lane` carries its `AgentLane` for the
 *  header colour / label, `archived` is the `done` lane with its own chrome
 *  (preview collapse, Delete all), `flat` renders with NO header. */
export type RosterGroupKind = 'pinned' | 'lane' | 'date' | 'flat' | 'archived';

/** One rendered section of the roster. */
export interface RosterGroup {
  /** Stable key for keyed rendering (`pinned`, `lane:attn`, `date:today`, `flat`, `archived`). */
  key: string;
  kind: RosterGroupKind;
  /** Header text ('' for the headerless `flat` section). */
  title: string;
  /** The lane for `lane` (attn/flight/paused) and `archived` (`done`) sections. */
  lane?: AgentLane;
  rows: AgentRow[];
}

/** Local-midnight epoch ms of the calendar day containing `ms`. */
function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * PURE: the date bucket for a last-activity timestamp (`tsSeconds`, unix SECONDS)
 * relative to `nowMs`, on LOCAL calendar days: same day → `today`, the previous
 * day → `yesterday`, 2..6 days back → `week`, older → `older`. A null /
 * non-finite / future timestamp is treated as `today` — a live session with no
 * activity time yet was just launched, so it is the newest thing on the list.
 */
export function dateBucketFor(tsSeconds: number | null, nowMs: number): DateBucket {
  if (tsSeconds === null || !Number.isFinite(tsSeconds)) return 'today';
  const tsMs = tsSeconds * 1000;
  if (tsMs >= nowMs) return 'today';
  const dayMs = 86_400_000;
  const days = Math.round((localDayStart(nowMs) - localDayStart(tsMs)) / dayMs);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'older';
}

/** Sort key: newest activity first; an unknown timestamp counts as newest. */
function recencyOf(r: AgentRow): number {
  return r.lastTs === null || !Number.isFinite(r.lastTs) ? Number.POSITIVE_INFINITY : r.lastTs;
}

/** PURE: a stable newest-first copy of `rows` by last activity. */
function newestFirst(rows: AgentRow[]): AgentRow[] {
  return rows
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => {
      const ka = recencyOf(a.r);
      const kb = recencyOf(b.r);
      if (ka !== kb) return ka > kb ? -1 : 1; // newer (or unknown = newest) first
      return a.idx - b.idx; // stable: equal-keyed rows keep their incoming order
    })
    .map((x) => x.r);
}

const LANE_TITLES: Record<AgentLane, string> = {
  attn: 'Needs you',
  flight: 'In flight',
  paused: 'Paused',
  done: 'Archived'
};

/**
 * PURE: section `orderedRows` (already in view order, pinned first) for display
 * under grouping `mode`: pinned → mode body → archived, with empty sections
 * omitted. Pinned ids with no row are ignored. Returns new arrays; never mutates
 * inputs.
 */
export function buildRosterGroups(
  orderedRows: ReadonlyArray<AgentRow>,
  mode: GroupingMode,
  pinnedIds: ReadonlyArray<string>,
  nowMs: number
): RosterGroup[] {
  const pinnedSet = new Set(pinnedIds);
  const pinned: AgentRow[] = [];
  const live: AgentRow[] = [];
  const archived: AgentRow[] = [];
  for (const r of orderedRows) {
    if (pinnedSet.has(r.paneId)) pinned.push(r);
    else if (laneForRow(r) === 'done') archived.push(r);
    else live.push(r);
  }

  const groups: RosterGroup[] = [];
  if (pinned.length > 0) groups.push({ key: 'pinned', kind: 'pinned', title: 'Pinned', rows: pinned });

  if (mode === 'status') {
    const byLane: Record<AgentLane, AgentRow[]> = { attn: [], flight: [], paused: [], done: [] };
    for (const r of live) byLane[laneForRow(r)].push(r);
    for (const lane of LANE_ORDER) {
      if (lane === 'done' || byLane[lane].length === 0) continue;
      groups.push({ key: `lane:${lane}`, kind: 'lane', title: LANE_TITLES[lane], lane, rows: byLane[lane] });
    }
  } else if (mode === 'date') {
    const byBucket: Record<DateBucket, AgentRow[]> = { today: [], yesterday: [], week: [], older: [] };
    for (const r of newestFirst(live)) byBucket[dateBucketFor(r.lastTs, nowMs)].push(r);
    for (const bucket of DATE_BUCKETS) {
      if (byBucket[bucket].length === 0) continue;
      groups.push({ key: `date:${bucket}`, kind: 'date', title: DATE_BUCKET_TITLES[bucket], rows: byBucket[bucket] });
    }
  } else if (live.length > 0) {
    groups.push({ key: 'flat', kind: 'flat', title: '', rows: newestFirst(live) });
  }

  if (archived.length > 0) {
    groups.push({ key: 'archived', kind: 'archived', title: LANE_TITLES.done, lane: 'done', rows: archived });
  }
  return groups;
}
