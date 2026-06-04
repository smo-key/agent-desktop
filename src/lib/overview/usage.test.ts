import { describe, expect, it } from 'vitest';
import { agentUsage, aggregate, type SubagentUsage } from './usage';
import type { AgentRow } from './roster';

// Tests for the PURE per-agent + aggregate usage view-models (Stage 1 of
// agent-overview). The `it(...)` titles are the EXACT `#### Scenario:` names from
// the agent-overview spec (Requirement: Agent Usage Tracking). The real subagent
// usage source is Stage 2 (Rust parse); here we stub the subagent-usage list.

import type { Snapshot } from '../usage/snapshots.svelte';

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    pane_id: 'p',
    session_id: null,
    model: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1,
    ...over
  };
}

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    paneId: 'p',
    workspaceId: 'ws',
    name: 'Agent',
    cwd: null,
    model: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    status: 'idle',
    projectId: null,
    ...over
  };
}

describe('usage — Agent Usage Tracking', () => {
  it('Per-agent usage reflects the snapshot', () => {
    const u = agentUsage(snap({ cost: 2.5, context_pct: 73 }));
    expect(u.cost).toBe(2.5);
    expect(u.contextPct).toBe(73);

    // Missing snapshot fields roll up to null (never NaN), and a missing snapshot
    // entirely yields a null usage rather than throwing.
    const empty = agentUsage(snap({ cost: null, context_pct: null }));
    expect(empty.cost).toBeNull();
    expect(empty.contextPct).toBeNull();
    expect(agentUsage(undefined)).toEqual({ cost: null, contextPct: null });

    // Non-finite garbage in the opaque payload is coerced to null, not NaN.
    const garbage = agentUsage(snap({ cost: NaN, context_pct: Infinity }));
    expect(garbage.cost).toBeNull();
    expect(garbage.contextPct).toBeNull();
  });

  it('Aggregate usage sums agents and subagents', () => {
    const rows: AgentRow[] = [
      row({ paneId: 'a', cost: 1.0 }),
      row({ paneId: 'b', cost: 2.5 }),
      row({ paneId: 'c', cost: null }) // no cost reported — skipped, not zero
    ];
    // Stubbed subagent-usage list (Stage 2 supplies the real source). A null usage
    // record is ignored entirely.
    const subagents: SubagentUsage[] = [
      { cost: 0.5 },
      { cost: 1.25 },
      { cost: null },
      null as unknown as SubagentUsage
    ];

    const total = aggregate(rows, subagents);

    // 1.0 + 2.5 (agents) + 0.5 + 1.25 (subagents) = 5.25
    expect(total.totalCost).toBeCloseTo(5.25, 10);
    expect(total.agentCost).toBeCloseTo(3.5, 10);
    expect(total.subagentCost).toBeCloseTo(1.75, 10);
  });

  it('Aggregate is null when nothing reported a cost', () => {
    const rows: AgentRow[] = [row({ paneId: 'a', cost: null })];
    const subagents: SubagentUsage[] = [{ cost: null }];

    const total = aggregate(rows, subagents);

    // No contributions at all => null total (an empty state, not a misleading $0).
    expect(total.totalCost).toBeNull();
    expect(total.agentCost).toBeNull();
    expect(total.subagentCost).toBeNull();
  });
});
