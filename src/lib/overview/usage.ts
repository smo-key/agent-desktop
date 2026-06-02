// PURE per-agent + aggregate usage view-models for the agent-overview surface
// (Stage 1, tasks.md 10.3; design D3). Per-agent usage {cost, contextPct} comes
// from the agent's latest snapshot; the aggregate sums every agent's cost together
// with every available subagent's recorded usage, IGNORING records whose usage is
// unavailable (null), so a missing reading is a skipped contribution — never a
// zero that masks an empty state, and never a NaN.
//
// Framework-free (no Svelte/Tauri imports) so it is trivially unit-tested. The
// subagent-usage source is the live Stage 2 subagent list (the Rust subagent parse
// + watcher): Overview.svelte projects `subagents.usageList` into the aggregate.
// This module consumes a plain `SubagentUsage[]`, so it stays decoupled from that
// store's shape and depends only on each record's `cost`.

import type { AgentRow } from './roster';
import type { Snapshot } from '../usage/snapshots.svelte';

/** Per-agent usage view-model: cost (USD) + context-window percentage. */
export interface AgentUsage {
  /** Total session cost in USD, or null when unknown. */
  cost: number | null;
  /** Context-window usage 0..100, or null when unknown. */
  contextPct: number | null;
}

/**
 * One subagent's recorded usage (the only field the aggregate needs in Stage 1).
 * Stage 2's Rust parse supplies the real list (label/status/usage per subagent);
 * here we depend ONLY on the `cost` so the math is decoupled from that shape. A
 * record whose `cost` is null (or the whole record null) is ignored by the sum.
 */
export interface SubagentUsage {
  /** The subagent's recorded cost in USD, or null when unavailable. */
  cost: number | null;
}

/** The aggregate usage total across all agents and their subagents. */
export interface AggregateUsage {
  /** Summed agent cost (present numeric contributions only), or null when none. */
  agentCost: number | null;
  /** Summed subagent cost (present numeric contributions only), or null when none. */
  subagentCost: number | null;
  /** agentCost + subagentCost (skipping nulls), or null when nothing reported. */
  totalCost: number | null;
}

/** Coerce to a finite number, else null (guards NaN/Infinity/strings). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * PURE per-agent usage from its latest snapshot: cost + context %. A missing
 * snapshot (the pane has no heartbeat yet) yields `{cost:null, contextPct:null}`;
 * non-finite payload values coerce to null (never NaN). Mutates nothing.
 */
export function agentUsage(snapshot: Snapshot | undefined): AgentUsage {
  return {
    cost: finiteOrNull(snapshot?.cost),
    contextPct: finiteOrNull(snapshot?.context_pct)
  };
}

/**
 * Fold an iterable of (possibly null/non-finite) cost contributions into a sum.
 * Present numeric values are added; null/missing contributions are SKIPPED (not
 * treated as zero). If NO contribution was present, the result is `null` (an
 * empty state) rather than `0` (a misleading total). Never NaN.
 */
function sumCosts(costs: Iterable<number | null | undefined>): number | null {
  let total: number | null = null;
  for (const raw of costs) {
    const c = finiteOrNull(raw);
    if (c !== null) total = (total ?? 0) + c;
  }
  return total;
}

/** Add two nullable sums, treating null as "no contribution" (not zero). */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * PURE aggregate usage: SUM each agent's cost together with each available
 * subagent's recorded cost. Agent rows with a null cost and subagent records with
 * a null (or absent) cost are ignored — exactly the spec's "ignoring records whose
 * usage is unavailable". When nothing at all reported a cost, every field is null.
 *
 * @param rows       the agent rows (each carrying its snapshot cost)
 * @param subagents  the subagent-usage list (Stage-2 source; a stub in Stage 1).
 *                   Null entries are tolerated and skipped.
 */
export function aggregate(
  rows: AgentRow[],
  subagents: readonly (SubagentUsage | null | undefined)[]
): AggregateUsage {
  const agentCost = sumCosts(rows.map((r) => r.cost));
  const subagentCost = sumCosts((subagents ?? []).map((s) => s?.cost));
  return {
    agentCost,
    subagentCost,
    totalCost: addNullable(agentCost, subagentCost)
  };
}
