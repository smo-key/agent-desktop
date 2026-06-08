import { describe, expect, it } from 'vitest';
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  coordinatorLaunchArgs,
  findCoordinatorPane,
  type CoordinatorPaneView
} from './coordinator';
import { buildMcpToolkitConfig } from '../usage/spawn';

describe('findCoordinatorPane (single-coordinator reuse, task 6.3)', () => {
  const panes: CoordinatorPaneView[] = [
    { paneId: 'shell-1', program: '/bin/zsh', projectId: 'A', role: 'coordinator' },
    { paneId: 'agent-1', program: 'claude', projectId: 'A' },
    { paneId: 'coord-A', program: 'claude', projectId: 'A', role: 'coordinator' },
    { paneId: 'coord-B', program: 'claude', projectId: 'B', role: 'coordinator' }
  ];

  it('finds the live coordinator for a project', () => {
    expect(findCoordinatorPane(panes, 'A')?.paneId).toBe('coord-A');
    expect(findCoordinatorPane(panes, 'B')?.paneId).toBe('coord-B');
  });

  it('returns null when a project has no coordinator', () => {
    expect(findCoordinatorPane(panes, 'C')).toBeNull();
  });

  it('ignores a non-claude pane even if marked coordinator', () => {
    // The shell pane in project A is role:coordinator but not claude — never matched.
    expect(findCoordinatorPane([panes[0]], 'A')).toBeNull();
  });

  it('ignores a closed (archived) coordinator', () => {
    const closed: CoordinatorPaneView[] = [
      { paneId: 'coord-A', program: 'claude', projectId: 'A', role: 'coordinator', closed: true }
    ];
    expect(findCoordinatorPane(closed, 'A')).toBeNull();
  });

  it('ignores a plain (non-coordinator) claude pane', () => {
    expect(findCoordinatorPane([panes[1]], 'A')).toBeNull();
  });

  it('returns null for a blank projectId', () => {
    expect(findCoordinatorPane(panes, '')).toBeNull();
    expect(findCoordinatorPane(panes, '   ')).toBeNull();
  });
});

describe('coordinatorLaunchArgs (task 6.2)', () => {
  const cfg = buildMcpToolkitConfig('/bin/orchestration-mcp.js', '/control.sock', 'proj-A');

  it('composes append-system-prompt + inline mcp-config', () => {
    const args = coordinatorLaunchArgs(cfg);
    expect(args[0]).toBe('--append-system-prompt');
    expect(args[1]).toBe(ORCHESTRATOR_SYSTEM_PROMPT);
    expect(args[2]).toBe('--mcp-config');
    // The mcp-config is inline JSON that round-trips back to the config object.
    expect(JSON.parse(args[3])).toEqual(cfg);
  });

  it('carries the coordinator projectId in the mcp-config env (project scoping)', () => {
    const args = coordinatorLaunchArgs(cfg);
    const parsed = JSON.parse(args[3]);
    expect(parsed.mcpServers.orchestration.env.AGENT_DESKTOP_PROJECT_ID).toBe('proj-A');
    expect(parsed.mcpServers.orchestration.env.AGENT_DESKTOP_CONTROL_SOCKET).toBe('/control.sock');
  });

  it('accepts a custom system prompt', () => {
    const args = coordinatorLaunchArgs(cfg, 'CUSTOM');
    expect(args[1]).toBe('CUSTOM');
  });
});

describe('ORCHESTRATOR_SYSTEM_PROMPT (task 6.4)', () => {
  it('is a focused orchestrator prompt with NO governance/guardrails', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/coordinat/i);
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/spawn_agent/);
    // Explicitly disclaims guardrail/approval responsibilities (separate future change).
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/guardrail|approval/i);
  });
});
