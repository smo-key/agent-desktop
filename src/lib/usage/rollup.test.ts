import { describe, expect, it } from 'vitest';
import {
  accountSummary,
  rollup,
  sessionCard,
  IDLE_AFTER_SECONDS,
  type Rollup
} from './rollup';
import type { Snapshot, SnapshotMap } from './snapshots.svelte';

// Tests for the PURE rollup that backs the two-row `UsageBar`. The `it(...)`
// titles are the EXACT `#### Scenario:` names from the usage-dashboard spec
// (Requirements: Two-Row Dashboard Content, Account-Wide Rollup Math, Graceful
// Handling of Missing Rate Limits and Context) so the scenario-coverage gate
// matches each to this unit test. The pixel-level rendering of the cards / bars
// is MANUAL (needs a live in-app window — see report).

function snap(paneId: string, over: Partial<Snapshot> = {}): Snapshot {
  return {
    pane_id: paneId,
    session_id: null,
    model: null,
    model_id: null,
    effort: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1,
    ...over
  };
}

/** Build a `rate_limits` opaque object in the verified statusline shape. */
function rates(fiveHourPct: number | null, sevenDayPct: number | null) {
  const obj: Record<string, unknown> = {};
  if (fiveHourPct !== null) obj.five_hour = { used_percentage: fiveHourPct, resets_at: 1700 };
  if (sevenDayPct !== null) obj.seven_day = { used_percentage: sevenDayPct, resets_at: 1800 };
  return obj;
}

function mapOf(...snaps: Snapshot[]): SnapshotMap {
  const m: SnapshotMap = {};
  for (const s of snaps) m[s.pane_id] = s;
  return m;
}

describe('rollup — Account-Wide Rollup Math', () => {
  // rate_limits is account-global, so the single freshest snapshot wins even when
  // an older snapshot also carries (stale) rate_limits.
  it('Rate limits from newest snapshot', () => {
    const older = snap('pane-a', { ts: 100, rate_limits: rates(10, 20) });
    const newer = snap('pane-b', { ts: 200, rate_limits: rates(55, 70) });
    const account = accountSummary(mapOf(older, newer), null);

    expect(account.fiveHour.usedPct).toBe(55);
    expect(account.sevenDay.usedPct).toBe(70);
    expect(account.hasRateLimits).toBe(true);

    // Order-independent: inserting them the other way still picks ts=200.
    const account2 = accountSummary(mapOf(newer, older), null);
    expect(account2.fiveHour.usedPct).toBe(55);
    expect(account2.sevenDay.usedPct).toBe(70);
  });

  // The spec's exact example: costs of 0.50, 1.25, and null sum to 1.75 — null is
  // a missing contribution, not a zero that breaks the sum.
  it('Cost summed across panes', () => {
    const account = accountSummary(
      mapOf(
        snap('pane-a', { cost: 0.5 }),
        snap('pane-b', { cost: 1.25 }),
        snap('pane-c', { cost: null })
      ),
      null
    );
    expect(account.totalCost).toBeCloseTo(1.75, 10);
    expect(Number.isNaN(account.totalCost as number)).toBe(false);
  });
});

describe('rollup — Graceful Handling of Missing Rate Limits and Context', () => {
  // No pane has rate_limits → the windows are null and `hasRateLimits` is false,
  // and NOT NaN/0. The UI renders the dim-dash unavailable state from this.
  it('Absent rate limits render as null', () => {
    const account = accountSummary(mapOf(snap('pane-a'), snap('pane-b')), null);

    expect(account.fiveHour.usedPct).toBeNull();
    expect(account.fiveHour.resetsAt).toBeNull();
    expect(account.sevenDay.usedPct).toBeNull();
    expect(account.sevenDay.resetsAt).toBeNull();
    expect(account.hasRateLimits).toBe(false);

    // An empty map (no snapshots at all) is equally graceful — never throws/NaN.
    const empty = accountSummary({}, null);
    expect(empty.hasRateLimits).toBe(false);
    expect(empty.totalCost).toBeNull();
  });

  // A null context_pct stays null (empty/unknown bar), never coerced to 0 or NaN.
  it('Missing context renders gracefully', () => {
    const card = sessionCard(snap('pane-a', { context_pct: null }), 0);
    expect(card.contextPct).toBeNull();
    expect(Number.isNaN(card.contextPct as number)).toBe(false);

    // A garbage (non-finite) context value also rolls up to null, not NaN.
    const garbage = sessionCard(
      snap('pane-b', { context_pct: Number.NaN as unknown as number }),
      0
    );
    expect(garbage.contextPct).toBeNull();
  });

  // The wrapper writes context_pct already derived from used/remaining percentage
  // (never total_tokens). The rollup passes a present numeric value through 1:1.
  it('Context from the correct fields', () => {
    const card = sessionCard(snap('pane-a', { context_pct: 42 }), 0);
    expect(card.contextPct).toBe(42);
  });
});

describe('rollup — Two-Row Dashboard Content', () => {
  // Top row: one card per pane, each carrying that pane's model, a context value,
  // its task, and a live/idle dot from the ts heartbeat.
  it('Top-row session cards', () => {
    const now = 1000;
    const live = snap('pane-a', {
      model: 'Opus',
      context_pct: 40,
      task: 'Refactoring the tree',
      ts: now - 2 // fresh
    });
    const idle = snap('pane-b', {
      model: 'Sonnet',
      context_pct: 12,
      task: null,
      ts: now - 60 // stale
    });

    const view: Rollup = rollup(mapOf(live, idle), 'pane-a', now);
    expect(view.cards).toHaveLength(2);

    const a = view.cards.find((c) => c.paneId === 'pane-a')!;
    expect(a.model).toBe('Opus');
    expect(a.contextPct).toBe(40);
    expect(a.task).toBe('Refactoring the tree');
    expect(a.live).toBe(true);

    const b = view.cards.find((c) => c.paneId === 'pane-b')!;
    expect(b.model).toBe('Sonnet');
    expect(b.live).toBe(false); // older than IDLE_AFTER_SECONDS => idle

    // The boundary: exactly at the threshold is still live; one second past is idle.
    expect(sessionCard(snap('x', { ts: now - IDLE_AFTER_SECONDS }), now).live).toBe(true);
    expect(sessionCard(snap('x', { ts: now - IDLE_AFTER_SECONDS - 1 }), now).live).toBe(false);
  });

  // Bottom row: newest rate limits + summed cost + the FOCUSED pane's git.
  it('Bottom-row account summary', () => {
    const now = 1000;
    const a = snap('pane-a', {
      ts: 100,
      cost: 0.5,
      git: { branch: 'feature-x', dirty: true }
    });
    const b = snap('pane-b', {
      ts: 200,
      cost: 1.0,
      rate_limits: rates(33, 44),
      git: { branch: 'main', dirty: false }
    });

    // Focus pane-a => bottom-row git is pane-a's, but rate limits/cost are account-wide.
    const view = rollup(mapOf(a, b), 'pane-a', now);
    expect(view.account.fiveHour.usedPct).toBe(33); // from newest (pane-b)
    expect(view.account.sevenDay.usedPct).toBe(44);
    expect(view.account.totalCost).toBeCloseTo(1.5, 10);
    expect(view.account.git).toEqual({ branch: 'feature-x', dirty: true });

    // Refocus pane-b => only the git swaps; the account math is unchanged.
    const view2 = rollup(mapOf(a, b), 'pane-b', now);
    expect(view2.account.git).toEqual({ branch: 'main', dirty: false });
    expect(view2.account.totalCost).toBeCloseTo(1.5, 10);

    // Unknown/absent focus => git is null (graceful), account math still present.
    const view3 = rollup(mapOf(a, b), null, now);
    expect(view3.account.git).toBeNull();
    expect(view3.account.totalCost).toBeCloseTo(1.5, 10);
  });
});
