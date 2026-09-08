import { beforeEach, describe, expect, it, vi } from 'vitest';

// Tests for the agent-backend settings store (`agent-backends` capability). The
// PURE `parseAgentPrefs` validator is the focus, plus the merge-aware save path
// and the install probe. Test titles below match the spec's `#### Scenario:`
// names for the coverage gate.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const loadSettingsMock = vi.fn(async (..._a: unknown[]): Promise<Record<string, unknown>> => ({}));
vi.mock('./persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a),
  loadSettings: (...a: unknown[]) => loadSettingsMock(...a)
}));

const invokeMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => true);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a)
}));

import { AgentStore, DEFAULT_AGENT_PREFS, parseAgentPrefs } from './agent.svelte';
import { defaultAgentKind, setAgentPreference } from '$lib/agent/defaultAgent';

beforeEach(() => {
  saveSliceMock.mockClear();
  loadSettingsMock.mockReset();
  loadSettingsMock.mockResolvedValue({});
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(true);
  setAgentPreference(null);
});

describe('parseAgentPrefs', () => {
  it('returns the defaults for undefined / null / non-object input', () => {
    expect(parseAgentPrefs(undefined)).toEqual(DEFAULT_AGENT_PREFS);
    expect(parseAgentPrefs(null)).toEqual(DEFAULT_AGENT_PREFS);
    expect(parseAgentPrefs('copilot')).toEqual(DEFAULT_AGENT_PREFS);
    expect(parseAgentPrefs([])).toEqual(DEFAULT_AGENT_PREFS);
  });

  it('reads a valid slice and rejects unknown kinds', () => {
    expect(parseAgentPrefs({ kind: 'copilot' })).toEqual({ kind: 'copilot' });
    expect(parseAgentPrefs({ kind: 'claude' })).toEqual({ kind: 'claude' });
    expect(parseAgentPrefs({ kind: 'gemini' })).toEqual({ kind: 'claude' });
  });
});

describe('AgentStore', () => {
  it('Choosing Copilot persists the slice', async () => {
    const store = new AgentStore();
    await store.load();
    store.setKind('copilot');
    expect(store.prefs.kind).toBe('copilot');
    expect(saveSliceMock).toHaveBeenCalledWith('agent', { kind: 'copilot' });
    // The pure resolver the launcher reads is kept in sync.
    expect(defaultAgentKind()).toBe('copilot');
  });

  it('Global default applies', async () => {
    loadSettingsMock.mockResolvedValueOnce({ agent: { kind: 'copilot' } });
    const store = new AgentStore();
    await store.load();
    expect(store.prefs.kind).toBe('copilot');
    expect(defaultAgentKind()).toBe('copilot');
  });

  it('Missing CLI shows a hint, not a block', async () => {
    invokeMock.mockResolvedValue(false); // program_on_path -> not found
    const store = new AgentStore();
    await store.load();
    store.setKind('copilot');
    await Promise.resolve();
    await Promise.resolve();
    expect(store.installed).toBe(false);
    // The selection is still saved — absence is a hint, never a block.
    expect(saveSliceMock).toHaveBeenCalledWith('agent', { kind: 'copilot' });
  });

  it('probe failure leaves installed unknown (no false negative)', async () => {
    invokeMock.mockRejectedValue(new Error('no tauri'));
    const store = new AgentStore();
    await store.load();
    expect(store.installed).toBeNull();
    expect(store.loaded).toBe(true);
  });

  it('defaults on a fresh / empty settings blob', async () => {
    const store = new AgentStore();
    await store.load();
    expect(store.prefs).toEqual(DEFAULT_AGENT_PREFS);
    expect(defaultAgentKind()).toBe('claude');
  });
});
