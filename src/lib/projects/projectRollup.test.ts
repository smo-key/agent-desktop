import { describe, expect, it } from 'vitest';
import {
  projectCounts,
  unassignedCount,
  filterRowsByProject,
  filterOrder,
  stepFilter,
  ALL,
  UNASSIGNED
} from './projectRollup';
import type { AgentRow, AgentStatus } from '../overview/roster';
import type { Project } from './projects';

function row(paneId: string, projectId: string | null, status: AgentStatus): AgentRow {
  return {
    paneId,
    workspaceId: 'ws',
    name: paneId,
    cwd: null,
    model: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    lastTs: null,
    status,
    projectId
  };
}

function proj(id: string): Project {
  return { id, name: id, path: '/' + id, icon: 'box', color: '#4C8DFF' };
}

describe('projectRollup — Filter agents by project', () => {
  const projects = [proj('pay'), proj('web')];
  const rows = [
    row('a', 'pay', 'working'),
    row('b', 'pay', 'waiting'), // attention
    row('c', 'web', 'finished'),
    row('d', null, 'working') // unassigned
  ];

  it('counts agents per project and flags attention', () => {
    const counts = projectCounts(rows, projects);
    expect(counts.map((c) => [c.project.id, c.count, c.attn])).toEqual([
      ['pay', 2, true], // b is waiting -> attention
      ['web', 1, false]
    ]);
    expect(unassignedCount(rows)).toBe(1);
  });

  it('Filter agents by project', () => {
    expect(filterRowsByProject(rows, ALL).map((r) => r.paneId)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterRowsByProject(rows, 'pay').map((r) => r.paneId)).toEqual(['a', 'b']);
    expect(filterRowsByProject(rows, 'web').map((r) => r.paneId)).toEqual(['c']);
    expect(filterRowsByProject(rows, UNASSIGNED).map((r) => r.paneId)).toEqual(['d']);
  });
});

describe('projectRollup — keyboard filter nav', () => {
  const projects = [proj('pay'), proj('web')];

  it('orders ALL, then projects, then UNASSIGNED only when present', () => {
    expect(filterOrder(projects, true)).toEqual([ALL, 'pay', 'web', UNASSIGNED]);
    expect(filterOrder(projects, false)).toEqual([ALL, 'pay', 'web']);
    expect(filterOrder([], false)).toEqual([ALL]);
  });

  it('steps next/previous through the order, clamped at both ends', () => {
    const order = filterOrder(projects, true); // [ALL, pay, web, UNASSIGNED]
    expect(stepFilter(order, ALL, 1)).toBe('pay');
    expect(stepFilter(order, 'web', 1)).toBe(UNASSIGNED);
    expect(stepFilter(order, UNASSIGNED, 1)).toBe(UNASSIGNED); // clamp at end
    expect(stepFilter(order, 'pay', -1)).toBe(ALL);
    expect(stepFilter(order, ALL, -1)).toBe(ALL); // clamp at start
  });

  it('starts from an end when the current selection is not in the order', () => {
    const order = filterOrder(projects, false); // [ALL, pay, web]
    expect(stepFilter(order, 'gone', 1)).toBe(ALL); // forward -> first
    expect(stepFilter(order, 'gone', -1)).toBe('web'); // backward -> last
  });
});
