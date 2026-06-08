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

  it('disallows the work tools + internal Task tool (task 10.1)', () => {
    const args = coordinatorLaunchArgs(cfg);
    const i = args.indexOf('--disallowedTools');
    expect(i).toBeGreaterThanOrEqual(0);
    // Each tool is a separate arg (claude's variadic flag), in this exact order.
    expect(args.slice(i + 1, i + 6)).toEqual(['Edit', 'Write', 'Bash', 'NotebookEdit', 'Task']);
  });

  it('still attaches the orchestration toolkit + orchestrator prompt alongside the deny-list', () => {
    const args = coordinatorLaunchArgs(cfg);
    // append-system-prompt + its value still present.
    const sp = args.indexOf('--append-system-prompt');
    expect(sp).toBeGreaterThanOrEqual(0);
    expect(args[sp + 1]).toBe(ORCHESTRATOR_SYSTEM_PROMPT);
    // mcp-config still present + round-trips to the toolkit config.
    const mc = args.indexOf('--mcp-config');
    expect(mc).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(args[mc + 1])).toEqual(cfg);
    // The deny-list MUST NOT name the orchestration MCP tools or read-only tools.
    expect(args).not.toContain('Read');
    expect(args).not.toContain('Glob');
    expect(args).not.toContain('Grep');
    expect(args.some((a) => a.startsWith('mcp__orchestration__'))).toBe(false);
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

  it('instructs the coordinator to delegate via spawn_agent and never do work itself (task 10.1)', () => {
    // Must NOT do hands-on work directly.
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/do not|don't|never/i);
    // Must delegate via spawn_agent.
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/spawn_agent/);
    // Must not use the Task tool.
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Task tool/);
  });
});
