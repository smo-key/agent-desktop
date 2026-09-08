import { describe, expect, it } from 'vitest';
import {
  AGENT_KINDS,
  backendFor,
  backendForProgram,
  copilotModelLabel,
  DEFAULT_AGENT_KIND,
  isAgentProgram,
  parseAgentKind
} from './backends';

describe('agent backend registry', () => {
  it('Claude backend descriptor', () => {
    const b = backendFor('claude');
    expect(b.program).toBe('claude');
    expect(b.freshArgs('S1')).toEqual(['--session-id', 'S1']);
    expect(b.resumeArgs('S1')).toEqual(['--resume', 'S1']);
    expect(b.mcpConfigArgs('{}')).toEqual(['--mcp-config', '{}']);
    expect(b.capabilities).toMatchObject({
      hooks: true,
      statusline: true,
      contextPct: true,
      tasksDir: true,
      subagents: true,
      specialists: true,
      askUserDriving: true
    });
    expect(b.busyMarkers).toContain('esc to interrupt');
  });

  it('Copilot backend descriptor', () => {
    const b = backendFor('copilot');
    expect(b.program).toBe('copilot');
    expect(b.freshArgs('S2')).toEqual(['--session-id', 'S2', '--no-remote']);
    expect(b.resumeArgs('S2')).toEqual(['--resume', 'S2', '--no-remote']);
    expect(b.mcpConfigArgs('{}')).toEqual(['--additional-mcp-config', '{}']);
    expect(b.capabilities).toMatchObject({
      hooks: false,
      statusline: false,
      contextPct: false,
      tasksDir: false,
      subagents: true,
      specialists: true,
      askUserDriving: false
    });
    expect(b.busyMarkers).toEqual([]);
    expect(b.busyPatterns).toEqual([]);
  });

  it('Agent-pane checks consult the registry', () => {
    expect(isAgentProgram('claude')).toBe(true);
    expect(isAgentProgram('copilot')).toBe(true);
    expect(isAgentProgram('/bin/zsh')).toBe(false);
    expect(isAgentProgram('')).toBe(false);
    expect(isAgentProgram(null)).toBe(false);
    expect(isAgentProgram(undefined)).toBe(false);
    expect(backendForProgram('copilot')?.kind).toBe('copilot');
    expect(backendForProgram('bash')).toBeNull();
  });

  it('registry lists every kind and defaults to claude', () => {
    expect(AGENT_KINDS).toEqual(['claude', 'copilot']);
    expect(DEFAULT_AGENT_KIND).toBe('claude');
  });

  it('parseAgentKind tolerates any persisted shape', () => {
    expect(parseAgentKind('copilot')).toBe('copilot');
    expect(parseAgentKind('claude')).toBe('claude');
    expect(parseAgentKind('vim')).toBe('claude');
    expect(parseAgentKind(undefined)).toBe('claude');
    expect(parseAgentKind({ nested: true })).toBe('claude');
  });

  it('readiness timing is declared per backend', () => {
    for (const kind of AGENT_KINDS) {
      const r = backendFor(kind).readiness;
      expect(r.quietMs).toBeGreaterThan(0);
      expect(r.maxMs).toBeGreaterThan(r.quietMs);
      expect(r.submitDelayMs).toBeGreaterThan(0);
    }
  });
});

describe('copilotModelLabel', () => {
  it('formats claude-family ids via the claude formatter', () => {
    expect(copilotModelLabel('claude-sonnet-5', null)).toBe('Sonnet 5');
    expect(copilotModelLabel('claude-haiku-4-5', null)).toBe('Haiku 4.5');
  });

  it('formats non-claude ids readably', () => {
    expect(copilotModelLabel('gpt-5', null)).toBe('GPT 5');
    expect(copilotModelLabel('o4-mini', null)).toBe('O4 Mini');
    expect(copilotModelLabel('gemini-2.5-pro', null)).toBe('Gemini 2.5 Pro');
  });

  it('falls back to display name then em-dash', () => {
    expect(copilotModelLabel(null, 'Custom Model')).toBe('Custom Model');
    expect(copilotModelLabel('', null)).toBe('—');
  });
});
