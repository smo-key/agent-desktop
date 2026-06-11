import { describe, it, expect } from 'vitest';
import { footerView, footerGitProjectId } from './footerView';
import { ALL, UNASSIGNED } from '$lib/projects/projectRollup';
import type { Snapshot, SnapshotMap } from './snapshots.svelte';
import type { Project } from '$lib/projects/projects';

function snap(over: Partial<Snapshot> & { pane_id: string }): Snapshot {
  return {
    session_id: null,
    model: null,
    model_id: null,
    effort: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 0,
    ...over,
  };
}

const PROJECTS: Project[] = [
  { id: 'p1', name: 'Mission Control', path: '/code/mc', icon: 'rocket', color: '#3CCB7F' },
];

describe('footerView', () => {
  it('resolves the focused pane project, git, and context', () => {
    const map: SnapshotMap = {
      a: snap({
        pane_id: 'a',
        context_pct: 78,
        cost: 1.24,
        git: { branch: 'feature-x', dirty: true, ahead: 2, behind: 0 },
        rate_limits: {
          five_hour: { used_percentage: 33, resets_at: 1 },
          seven_day: { used_percentage: 21, resets_at: 2 },
        },
        ts: 100,
      }),
    };
    const view = footerView(map, 'a', 'p1', PROJECTS);
    expect(view.project?.name).toBe('Mission Control');
    expect(view.git).toEqual({ branch: 'feature-x', dirty: true, ahead: 2, behind: 0 });
    expect(view.context).toBe(78);
    expect(view.cost).toBe(1.24);
    expect(view.lastTs).toBe(100);
    expect(view.fiveHour.usedPct).toBe(33);
    expect(view.sevenDay.usedPct).toBe(21);
  });

  it('null project when projectId is null or unknown', () => {
    const view = footerView({}, null, null, PROJECTS);
    expect(view.project).toBeNull();
    expect(footerView({}, null, 'nope', PROJECTS).project).toBeNull();
  });

  it('null git/context when the focused pane has no snapshot, but limits still roll up', () => {
    const map: SnapshotMap = {
      other: snap({
        pane_id: 'other',
        rate_limits: { five_hour: { used_percentage: 5, resets_at: 1 } },
        ts: 50,
      }),
    };
    const view = footerView(map, 'missing', null, PROJECTS);
    expect(view.git).toBeNull();
    expect(view.context).toBeNull();
    expect(view.cost).toBeNull();
    expect(view.lastTs).toBeNull();
    expect(view.fiveHour.usedPct).toBe(5);
  });

  it('coerces a non-finite context_pct to null', () => {
    const map: SnapshotMap = { a: snap({ pane_id: 'a', context_pct: Number.NaN }) };
    expect(footerView(map, 'a', null, PROJECTS).context).toBeNull();
  });

  // The two titles below mirror the `usage-dashboard` spec scenarios for the footer
  // model/effort pills so the scenario-coverage gate maps each to this footerView
  // assertion (footerView is the pure surface backing the rendered pills).
  it('Model and effort pills shown for the focused session', () => {
    const map: SnapshotMap = {
      a: snap({
        pane_id: 'a',
        model: 'Claude Opus 4.8',
        model_id: 'claude-opus-4-8',
        effort: 'high',
      }),
    };
    const view = footerView(map, 'a', null, PROJECTS);
    expect(view.model).toBe('Claude Opus 4.8');
    expect(view.model_id).toBe('claude-opus-4-8');
    expect(view.effort).toBe('high');
  });

  it('Effort pill omitted when unavailable', () => {
    const map: SnapshotMap = {
      a: snap({
        pane_id: 'a',
        model: 'Claude Sonnet 4.6',
        model_id: 'claude-sonnet-4-6',
        effort: null,
      }),
    };
    const view = footerView(map, 'a', null, PROJECTS);
    expect(view.model).toBe('Claude Sonnet 4.6');
    expect(view.model_id).toBe('claude-sonnet-4-6');
    expect(view.effort).toBeNull();
  });

  it('returns null model/model_id/effort when no pane is focused', () => {
    const view = footerView({}, null, null, PROJECTS);
    expect(view.model).toBeNull();
    expect(view.model_id).toBeNull();
    expect(view.effort).toBeNull();
  });

  it('returns null model/model_id/effort when the focused pane has no snapshot', () => {
    const map: SnapshotMap = {
      other: snap({ pane_id: 'other', model: 'Claude Opus 4', model_id: 'claude-opus-4', effort: 'max' }),
    };
    const view = footerView(map, 'missing', null, PROJECTS);
    expect(view.model).toBeNull();
    expect(view.model_id).toBeNull();
    expect(view.effort).toBeNull();
  });
});

describe('footerGitProjectId', () => {
  // Titles below mirror the `projects` spec scenarios so the scenario-coverage
  // gate maps each to this resolver — the logic that decides which project's
  // folder git the footer's left zone shows.
  // No apostrophe in this title on purpose: the coverage gate's test-title scan
  // stops at a quote, and the spec scenario's snake strips it to "panes" anyway.
  it('Footer shows the focused panes project git', () => {
    expect(footerGitProjectId('p1', 'p2')).toBe('p1');
    expect(footerGitProjectId('p1', ALL)).toBe('p1');
  });

  it('Footer falls back to the panel selection in the overview', () => {
    expect(footerGitProjectId(null, 'p2')).toBe('p2');
  });

  it('No project git for a non-project selection', () => {
    expect(footerGitProjectId(null, ALL)).toBeNull();
    expect(footerGitProjectId(null, UNASSIGNED)).toBeNull();
  });

  it('yields null when neither source names a project', () => {
    expect(footerGitProjectId(null, '')).toBeNull();
  });
});
