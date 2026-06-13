import { describe, it, expect } from 'vitest';
import {
  groupSubagentsByPhase,
  formatDurationAlive,
  isSubagentExited,
  liveSubagents,
} from './subagentRows';
import type { Subagent } from './subagents.svelte';

/** Build a Subagent fixture with the required keys and any overrides. */
function sub(overrides: Partial<Subagent> & { id: string }): Subagent {
  return { parentSession: 'sess-1', ...overrides };
}

describe('groupSubagentsByPhase', () => {
  // Scenario: "Subagents appear nested under their parent agent"
  it('Subagents appear nested under their parent agent', () => {
    const subs: Subagent[] = [
      sub({ id: 'a1', label: 'spec:a', workflowId: 'wf_1', phaseTitle: 'Design', phaseIndex: 2 }),
      sub({ id: 'a2', label: 'spec:b', workflowId: 'wf_1', phaseTitle: 'Capabilities', phaseIndex: 1 }),
      sub({ id: 'a3', label: 'spec:c', workflowId: 'wf_1', phaseTitle: 'Capabilities', phaseIndex: 1 }),
      sub({ id: 'b1', label: 'impl', workflowId: 'wf_2', phaseTitle: 'Build', phaseIndex: 1 }),
    ];

    const groups = groupSubagentsByPhase(subs);

    // Nested by workflow, in first-seen order.
    expect(groups.map((g) => g.workflowId)).toEqual(['wf_1', 'wf_2']);

    // Within wf_1, phases are ordered by phaseIndex (Capabilities #1 before Design #2),
    // and the two Capabilities subagents stay grouped in input order.
    expect(groups[0].phases.map((p) => p.phaseTitle)).toEqual(['Capabilities', 'Design']);
    expect(groups[0].phases[0].subagents.map((s) => s.id)).toEqual(['a2', 'a3']);
    expect(groups[0].phases[1].subagents.map((s) => s.id)).toEqual(['a1']);

    // wf_2 nests its single phase + subagent under itself.
    expect(groups[1].phases[0].phaseTitle).toBe('Build');
    expect(groups[1].phases[0].subagents.map((s) => s.id)).toEqual(['b1']);
  });

  it('routes subagents missing workflow id or phase into trailing null buckets, never dropping them', () => {
    const subs: Subagent[] = [
      sub({ id: 'a1', workflowId: 'wf_1', phaseTitle: 'Phase', phaseIndex: 1 }),
      sub({ id: 'a2', workflowId: 'wf_1' }), // no phase -> null phase, sorts last
      sub({ id: 'x1' }), // no workflow id -> trailing null workflow group
    ];

    const groups = groupSubagentsByPhase(subs);

    expect(groups.map((g) => g.workflowId)).toEqual(['wf_1', null]);
    // Within wf_1, the known-index phase comes before the unknown (null) phase.
    expect(groups[0].phases.map((p) => p.phaseTitle)).toEqual(['Phase', null]);
    expect(groups[0].phases[1].subagents.map((s) => s.id)).toEqual(['a2']);
    // The workflow-less subagent still surfaces under the null group.
    expect(groups[1].phases[0].subagents.map((s) => s.id)).toEqual(['x1']);
  });

  it('returns an empty array for no subagents', () => {
    expect(groupSubagentsByPhase([])).toEqual([]);
  });
});

describe('formatDurationAlive', () => {
  // Scenario: "Duration alive reflects finished versus running subagents"
  it('Duration alive reflects finished versus running subagents', () => {
    // Finished: uses the recorded durationMs (134s -> "2m 14s"), ignoring now.
    expect(formatDurationAlive({ durationMs: 134_000, startedAt: 1000 }, 9_999_999)).toBe('2m 14s');

    // Running: no final durationMs -> elapsed since startedAt relative to now.
    expect(formatDurationAlive({ durationMs: null, startedAt: 1_000_000 }, 1_005_000)).toBe('5s');

    // Hours roll up to a two-unit "Hh Mm" label.
    expect(formatDurationAlive({ startedAt: 0 }, 3_780_000)).toBe('1h 3m');

    // Neither known -> empty string.
    expect(formatDurationAlive({}, 1234)).toBe('');

    // A clock behind startedAt clamps to 0s rather than going negative.
    expect(formatDurationAlive({ startedAt: 5000 }, 1000)).toBe('0s');
  });
});

describe('isSubagentExited', () => {
  // Scenario: "Exited subagents drop off the list"
  it('treats known finished/errored states as exited; live/unknown as not', () => {
    // Terminal — the subagent has exited (success OR failure).
    for (const s of ['done', 'completed', 'success', 'error', 'failed', 'DONE', 'Failed']) {
      expect(isSubagentExited(s)).toBe(true);
    }
    // Live / pending / unknown — still shown (never hidden on uncertainty).
    for (const s of ['running', 'queued', 'active', 'weird', '', null, undefined]) {
      expect(isSubagentExited(s)).toBe(false);
    }
  });
});

describe('liveSubagents', () => {
  // Scenario: "Exited subagents drop off the list"
  it('Exited subagents drop off the list', () => {
    const subs: Subagent[] = [
      sub({ id: 'run1', status: 'running' }),
      sub({ id: 'done1', status: 'done' }),
      sub({ id: 'err1', status: 'error' }),
      sub({ id: 'queued1', status: 'queued' }),
      sub({ id: 'unknown1', status: null }),
    ];
    expect(liveSubagents(subs).map((s) => s.id)).toEqual(['run1', 'queued1', 'unknown1']);
  });

  it('returns an empty array when every subagent has exited', () => {
    const subs: Subagent[] = [
      sub({ id: 'd', status: 'done' }),
      sub({ id: 'e', status: 'failed' }),
    ];
    expect(liveSubagents(subs)).toEqual([]);
  });
});
