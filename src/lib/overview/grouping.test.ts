import { describe, expect, it } from 'vitest';
import { buildRosterGroups, dateBucketFor, type RosterGroup } from './grouping';
import { LANE_ORDER, type AgentRow } from './roster';

// Tests for the PURE roster grouping (agent-roster-display: "The roster grouping
// is user-selectable"). `buildRosterGroups` takes the already lane-ordered +
// pinned-first rows and produces the ordered sections the Inbox renders: pinned
// first, the mode's body (status lanes / date buckets / one flat list), archived
// last. Timestamps are unix SECONDS (AgentRow.lastTs); "now" is epoch ms.

const row = (paneId: string, over: Partial<AgentRow> = {}): AgentRow => ({
  paneId,
  workspaceId: 'ws',
  name: paneId,
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
  ...over
});

// A fixed local "now": 2026-09-07 15:00 local time.
const NOW = new Date(2026, 8, 7, 15, 0, 0).getTime();
const secs = (ms: number) => Math.floor(ms / 1000);
const daysAgo = (d: number, hour = 10) => secs(new Date(2026, 8, 7 - d, hour, 0, 0).getTime());

const ids = (g: RosterGroup | undefined) => (g ? g.rows.map((r) => r.paneId) : undefined);
const keys = (gs: RosterGroup[]) => gs.map((g) => g.key);

describe('dateBucketFor', () => {
  it('buckets on local calendar days', () => {
    expect(dateBucketFor(daysAgo(0, 0), NOW)).toBe('today'); // midnight today
    expect(dateBucketFor(daysAgo(0, 14), NOW)).toBe('today');
    expect(dateBucketFor(daysAgo(1, 23), NOW)).toBe('yesterday'); // 23:00 yesterday = 16h ago
    expect(dateBucketFor(daysAgo(1, 0), NOW)).toBe('yesterday');
    expect(dateBucketFor(daysAgo(2, 23), NOW)).toBe('week');
    expect(dateBucketFor(daysAgo(6, 0), NOW)).toBe('week');
    expect(dateBucketFor(daysAgo(7, 23), NOW)).toBe('older');
    expect(dateBucketFor(daysAgo(20), NOW)).toBe('older');
  });

  it('treats an unknown, non-finite, or future timestamp as today', () => {
    expect(dateBucketFor(null, NOW)).toBe('today');
    expect(dateBucketFor(Number.NaN, NOW)).toBe('today');
    expect(dateBucketFor(secs(NOW) + 3600, NOW)).toBe('today');
  });
});

describe('buildRosterGroups', () => {
  it('status grouping is the default and matches the lanes', () => {
    const rows = [
      row('a', { status: 'waiting' }),
      row('b', { status: 'error' }),
      row('c', { status: 'working' }),
      row('d', { status: 'idle' }),
      row('e', { status: 'waiting', paused: true })
    ];
    const groups = buildRosterGroups(rows, 'status', [], NOW);
    expect(keys(groups)).toEqual(['lane:attn', 'lane:flight', 'lane:paused']);
    expect(groups.map((g) => g.kind)).toEqual(['lane', 'lane', 'lane']);
    expect(groups.map((g) => g.lane)).toEqual(['attn', 'flight', 'paused']);
    expect(ids(groups[0])).toEqual(['a', 'b']);
    expect(ids(groups[1])).toEqual(['c', 'd']);
    expect(ids(groups[2])).toEqual(['e']);
    // Lane groups keep the incoming order, in LANE_ORDER.
    expect(LANE_ORDER.slice(0, 3)).toEqual(groups.map((g) => g.lane));
  });

  it('date grouping buckets sessions by local calendar day', () => {
    const rows = [
      row('old', { lastTs: daysAgo(20) }),
      row('t1', { lastTs: daysAgo(0, 9) }),
      row('y', { lastTs: daysAgo(1) }),
      row('t2', { lastTs: daysAgo(0, 12) }),
      row('w', { lastTs: daysAgo(4) })
    ];
    const groups = buildRosterGroups(rows, 'date', [], NOW);
    expect(keys(groups)).toEqual(['date:today', 'date:yesterday', 'date:week', 'date:older']);
    expect(groups.map((g) => g.title)).toEqual(['Today', 'Yesterday', 'Last 7 days', 'Older']);
    expect(groups.every((g) => g.kind === 'date')).toBe(true);
    // Newest first within a bucket.
    expect(ids(groups[0])).toEqual(['t2', 't1']);
    expect(ids(groups[1])).toEqual(['y']);
    expect(ids(groups[2])).toEqual(['w']);
    expect(ids(groups[3])).toEqual(['old']);
  });

  it('a session with no activity time groups as newest', () => {
    const rows = [row('t', { lastTs: daysAgo(0, 12) }), row('fresh', { lastTs: null })];
    const groups = buildRosterGroups(rows, 'date', [], NOW);
    expect(keys(groups)).toEqual(['date:today']);
    expect(ids(groups[0])).toEqual(['fresh', 't']);
  });

  it('none renders a flat list without headers', () => {
    const rows = [
      row('a', { status: 'waiting', lastTs: daysAgo(3) }),
      row('b', { status: 'working', lastTs: daysAgo(0) }),
      row('c', { status: 'idle', lastTs: null }),
      row('d', { status: 'working', paused: true, lastTs: daysAgo(1) })
    ];
    const groups = buildRosterGroups(rows, 'none', [], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('flat');
    expect(groups[0].title).toBe('');
    expect(ids(groups[0])).toEqual(['c', 'b', 'd', 'a']);
  });

  it('pinned stay on top and archived at the bottom in every mode', () => {
    const rows = [
      // Incoming order is already pinned-first (pinRowsToTop) then lane order.
      row('p2', { status: 'working', lastTs: daysAgo(9) }),
      row('p1', { status: 'waiting', closed: true, lastTs: daysAgo(0) }),
      row('live1', { status: 'waiting', lastTs: daysAgo(0) }),
      row('live2', { status: 'working', lastTs: daysAgo(3) }),
      row('arch1', { status: 'finished', closed: true, lastTs: daysAgo(0) }),
      row('arch2', { status: 'waiting', preview: true, lastTs: daysAgo(30) })
    ];
    for (const mode of ['status', 'date', 'none'] as const) {
      const groups = buildRosterGroups(rows, mode, ['p2', 'p1'], NOW);
      expect(groups[0].kind).toBe('pinned');
      expect(groups[0].key).toBe('pinned');
      expect(ids(groups[0])).toEqual(['p2', 'p1']);
      const last = groups[groups.length - 1];
      expect(last.kind).toBe('archived');
      expect(last.key).toBe('archived');
      expect(last.lane).toBe('done');
      expect(ids(last)).toEqual(['arch1', 'arch2']);
      const body = groups.slice(1, -1).flatMap((g) => g.rows.map((r) => r.paneId));
      expect(body.sort()).toEqual(['live1', 'live2']);
      expect(body).not.toContain('p1');
      expect(body).not.toContain('arch1');
    }
  });

  it('empty groups are omitted', () => {
    expect(buildRosterGroups([], 'status', [], NOW)).toEqual([]);
    expect(buildRosterGroups([], 'date', [], NOW)).toEqual([]);
    expect(buildRosterGroups([], 'none', [], NOW)).toEqual([]);
    const only = buildRosterGroups([row('a', { status: 'working' })], 'status', ['zzz'], NOW);
    expect(keys(only)).toEqual(['lane:flight']);
    const onlyArchived = buildRosterGroups([row('a', { closed: true })], 'date', [], NOW);
    expect(keys(onlyArchived)).toEqual(['archived']);
  });

  it('the view order follows the rendered grouping', () => {
    const rows = [
      row('p', { status: 'idle', lastTs: daysAgo(9) }),
      row('a', { status: 'waiting', lastTs: daysAgo(2) }),
      row('b', { status: 'working', lastTs: daysAgo(0) }),
      row('z', { closed: true, lastTs: daysAgo(0) })
    ];
    const flat = (mode: 'status' | 'date' | 'none') =>
      buildRosterGroups(rows, mode, ['p'], NOW).flatMap((g) => g.rows.map((r) => r.paneId));
    expect(flat('status')).toEqual(['p', 'a', 'b', 'z']);
    expect(flat('date')).toEqual(['p', 'b', 'a', 'z']);
    expect(flat('none')).toEqual(['p', 'b', 'a', 'z']);
  });

  it('never mutates its inputs', () => {
    const rows = [row('b', { lastTs: daysAgo(1) }), row('a', { lastTs: daysAgo(0) })];
    const snapshot = rows.map((r) => r.paneId);
    buildRosterGroups(rows, 'date', [], NOW);
    buildRosterGroups(rows, 'none', [], NOW);
    expect(rows.map((r) => r.paneId)).toEqual(snapshot);
  });
});
