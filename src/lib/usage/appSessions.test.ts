import { isAgentProgram } from '$lib/agent/backends';
import { describe, expect, it } from 'vitest';
import { appSessionIds, appSessionKey } from './appSessions';
import type { Snapshot, SnapshotMap } from './snapshots.svelte';

// Tests for the PURE helper that extracts the app-launched session-id exclude-set
// from the per-pane snapshot map (Milestone 4, design D7). The foreign-sessions
// subsystem excludes exactly these ids so the app never shows one of its own panes
// as "external".

function snap(paneId: string, sessionId: string | null): Snapshot {
  return {
    pane_id: paneId,
    session_id: sessionId,
    model: null,
    model_id: null,
    effort: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 1
  };
}

describe('appSessionIds', () => {
  it('collects sorted, de-duped, non-empty session ids', () => {
    const map: SnapshotMap = {
      'pane-c': snap('pane-c', 'sess-b'),
      'pane-a': snap('pane-a', 'sess-a'),
      'pane-b': snap('pane-b', 'sess-a'), // duplicate session id (e.g. a fork)
      'pane-d': snap('pane-d', null), // no session yet -> skipped
      'pane-e': snap('pane-e', '') // empty -> skipped
    };
    expect(appSessionIds(map)).toEqual(['sess-a', 'sess-b']);
  });

  it('is empty for an empty map', () => {
    expect(appSessionIds({})).toEqual([]);
  });
});

describe('agent-pane classification (usage-dashboard)', () => {
  it('Non-agent filtering uses the registry', () => {
    // The footer's "terminal panes" filter asks the backend registry, so a
    // copilot pane counts as an agent session exactly like claude, and only
    // real shells are treated as terminals.
    expect(isAgentProgram('claude')).toBe(true);
    expect(isAgentProgram('copilot')).toBe(true);
    expect(isAgentProgram('/bin/zsh')).toBe(false);
    expect(isAgentProgram('pwsh')).toBe(false);
  });
});

describe('appSessionKey', () => {
  it('session set key ignores snapshots that do not change the set', () => {
    const before: SnapshotMap = { 'pane-a': snap('pane-a', 'sess-a'), 'pane-b': snap('pane-b', 'sess-b') };
    // A cost/context update: a NEW map (and new snapshot objects), same session ids.
    const after: SnapshotMap = { ...before, 'pane-a': { ...snap('pane-a', 'sess-a'), cost: 1.5, ts: 2 } };
    expect(after).not.toBe(before);
    expect(appSessionKey(after)).toBe(appSessionKey(before));
    // Adding or removing a session id changes the key.
    const added: SnapshotMap = { ...before, 'pane-c': snap('pane-c', 'sess-c') };
    expect(appSessionKey(added)).not.toBe(appSessionKey(before));
    const removed: SnapshotMap = { 'pane-a': snap('pane-a', 'sess-a') };
    expect(appSessionKey(removed)).not.toBe(appSessionKey(before));
  });
});
