import { describe, expect, it } from 'vitest';
import {
  defaultAgentPaths,
  parseAgentPaths,
  placeholderFor,
  resolveAgentExecutable
} from './agentPaths';

// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// wsl-agent-launch spec, so the coverage gate can match them.

describe('wsl-agent-launch agent paths', () => {
  it('Correcting a mis-detected executable', () => {
    // An explicit preference WINS over detection — that is the whole point of
    // the setting: detection is a heuristic the user must be able to override.
    const prefs = { claude: '/opt/claude/bin/claude', copilot: '' };
    const detected = { claude: '/home/u/.local/bin/claude', copilot: null };
    expect(resolveAgentExecutable('claude', prefs, detected)).toBe('/opt/claude/bin/claude');
  });

  it('The detected value is visible when unset', () => {
    // With nothing stored, the placeholder shows what WOULD be spawned.
    const detected = { claude: '/home/v-patel/.local/bin/claude', copilot: null };
    expect(placeholderFor('claude', detected)).toBe('/home/v-patel/.local/bin/claude');
    // Nothing detected: the bare program name is still the honest answer,
    // because that is exactly what an empty field will spawn.
    expect(placeholderFor('copilot', detected)).toBe('copilot');
    expect(placeholderFor('claude', null)).toBe('claude');
  });

  it('Clearing the preference', () => {
    const detected = { claude: '/home/u/.local/bin/claude', copilot: null };
    expect(resolveAgentExecutable('claude', { claude: '', copilot: '' }, detected)).toBe(
      '/home/u/.local/bin/claude'
    );
    // Whitespace-only is a clear, not a path.
    expect(resolveAgentExecutable('claude', { claude: '   ', copilot: '' }, detected)).toBe(
      '/home/u/.local/bin/claude'
    );
  });

  it('Executable preference survives a restart', () => {
    // Rehydrating the persisted slice on the next launch yields the same value.
    const rehydrated = parseAgentPaths({ claude: '/opt/claude', copilot: '/opt/copilot' });
    expect(rehydrated.claude).toBe('/opt/claude');
    expect(resolveAgentExecutable('claude', rehydrated, {})).toBe('/opt/claude');
  });

  it('Detection finds nothing', () => {
    // A failed/empty probe must never block a launch: we fall back to the bare
    // backend program, which is exactly today's behavior.
    for (const detected of [null, undefined, {}, { claude: null }, { claude: '  ' }]) {
      expect(resolveAgentExecutable('claude', null, detected)).toBe('claude');
    }
    expect(resolveAgentExecutable('copilot', null, {})).toBe('copilot');
  });

  it('tolerates a malformed persisted slice', () => {
    for (const bad of [null, undefined, 42, 'x', [], { claude: 42 }, { nope: 'x' }]) {
      expect(parseAgentPaths(bad)).toEqual(defaultAgentPaths());
    }
    // A partially-valid object keeps the valid half.
    expect(parseAgentPaths({ claude: '/a', copilot: 7 })).toEqual({
      claude: '/a',
      copilot: ''
    });
  });

  it('covers every registered backend', () => {
    // Driven off AGENT_KINDS so a future backend needs no edit here or in the UI.
    expect(Object.keys(defaultAgentPaths()).sort()).toEqual(['claude', 'copilot']);
  });
});
