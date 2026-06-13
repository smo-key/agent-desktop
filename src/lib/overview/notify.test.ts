import { describe, expect, it } from 'vitest';
import {
  newlyNeedsAttention,
  attentionIds,
  shouldAlert,
  channelsToAlert,
  notificationBody,
  notificationTitle,
  type AlertContext,
  type NotificationPrefs
} from './notify';
import type { AgentRow, AgentStatus } from './roster';

// Tests for the PURE needs-input-alerts core. The `it(...)` titles are the EXACT
// `#### Scenario:` names from the `needs-input-alerts` spec so the scenario-
// coverage gate maps each to this unit test. The reactive shell (alerts.svelte.ts:
// firing the chime + Tauri notification, OS permission, window focus) and the
// Settings picker are LIVE/MANUAL.

/** A roster row fixture — only the fields the alert core reads matter. */
function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    paneId: 'p1',
    workspaceId: 'w1',
    name: 'agent',
    cwd: null,
    model: null,
    modelId: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    lastTs: null,
    status: 'waiting' as AgentStatus,
    projectId: null,
    closed: false,
    paused: false,
    preview: false,
    ...over
  };
}

/** A focus context with sensible defaults (app focused, viewing nothing). */
function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return { appFocused: true, viewedPaneId: null, ...over };
}

/** Prefs with both channels set to one mode (override per channel as needed). */
function prefs(over: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return { sound: { mode: 'always' }, desktop: { mode: 'always' }, ...over };
}

describe('Alert on entry into Needs input', () => {
  it('Agent goes quiet at its prompt', () => {
    const prev = new Set<string>(); // primed, agent was working
    const fresh = newlyNeedsAttention(prev, [row({ paneId: 'p1', status: 'waiting' })]);
    expect(fresh.map((r) => r.paneId)).toEqual(['p1']);
  });

  it('Agent errors out', () => {
    const prev = new Set<string>();
    const fresh = newlyNeedsAttention(prev, [row({ paneId: 'p1', status: 'error' })]);
    expect(fresh.map((r) => r.paneId)).toEqual(['p1']);
  });

  it('Agent stays waiting', () => {
    const rows = [row({ paneId: 'p1', status: 'waiting' })];
    const prev = attentionIds(rows); // already counted as attention last tick
    expect(newlyNeedsAttention(prev, rows)).toEqual([]);
  });

  it('Agent re-enters Needs input', () => {
    // waiting -> working (leaves attention) -> waiting (re-enters): the second
    // entry is fresh again because it was absent from the in-between baseline.
    let prev = attentionIds([row({ paneId: 'p1', status: 'waiting' })]);
    prev = attentionIds([row({ paneId: 'p1', status: 'working' })]); // left attention
    const fresh = newlyNeedsAttention(prev, [row({ paneId: 'p1', status: 'waiting' })]);
    expect(fresh.map((r) => r.paneId)).toEqual(['p1']);
  });

  it('Paused or archived agent', () => {
    const prev = new Set<string>();
    const rows = [
      row({ paneId: 'paused', status: 'waiting', paused: true }),
      row({ paneId: 'closed', status: 'error', closed: true }),
      row({ paneId: 'preview', status: 'waiting', preview: true })
    ];
    expect(newlyNeedsAttention(prev, rows)).toEqual([]);
  });
});

describe('Independent sound and desktop channels', () => {
  it('Sound only', () => {
    const ch = channelsToAlert(
      prefs({ sound: { mode: 'always' }, desktop: { mode: 'off' } }),
      row(),
      ctx()
    );
    expect(ch).toEqual({ sound: true, desktop: false });
  });

  it('Desktop only', () => {
    const ch = channelsToAlert(
      prefs({ sound: { mode: 'off' }, desktop: { mode: 'always' } }),
      row(),
      ctx()
    );
    expect(ch).toEqual({ sound: false, desktop: true });
  });

  it('Both channels', () => {
    const ch = channelsToAlert(
      prefs({ sound: { mode: 'always' }, desktop: { mode: 'always' } }),
      row(),
      ctx()
    );
    expect(ch).toEqual({ sound: true, desktop: true });
  });

  it('Both channels off', () => {
    const ch = channelsToAlert(
      prefs({ sound: { mode: 'off' }, desktop: { mode: 'off' } }),
      row(),
      ctx()
    );
    expect(ch).toEqual({ sound: false, desktop: false });
  });

  it('Channels configured independently', () => {
    // Sound 'always', desktop 'app-unfocused' while the app IS focused: sound
    // fires, desktop does not — each channel obeys only its own mode.
    const ch = channelsToAlert(
      prefs({ sound: { mode: 'always' }, desktop: { mode: 'app-unfocused' } }),
      row(),
      ctx({ appFocused: true })
    );
    expect(ch).toEqual({ sound: true, desktop: false });
  });
});

describe('Per-channel alert mode', () => {
  it('Mode off', () => {
    expect(shouldAlert('off', row(), ctx({ appFocused: false }))).toBe(false);
    expect(shouldAlert('off', row(), ctx({ appFocused: true }))).toBe(false);
  });

  it('Mode always', () => {
    expect(shouldAlert('always', row({ paneId: 'p1' }), ctx({ appFocused: true, viewedPaneId: 'p1' }))).toBe(true);
    expect(shouldAlert('always', row(), ctx({ appFocused: false }))).toBe(true);
  });

  it('Mode app-unfocused, window unfocused', () => {
    expect(shouldAlert('app-unfocused', row(), ctx({ appFocused: false }))).toBe(true);
  });

  it('Mode app-unfocused, window focused', () => {
    expect(shouldAlert('app-unfocused', row(), ctx({ appFocused: true }))).toBe(false);
  });

  it('Mode agent-unfocused, viewing that agent', () => {
    expect(
      shouldAlert('agent-unfocused', row({ paneId: 'p1' }), ctx({ appFocused: true, viewedPaneId: 'p1' }))
    ).toBe(false);
  });

  it('Mode agent-unfocused, viewing a different agent', () => {
    expect(
      shouldAlert('agent-unfocused', row({ paneId: 'p1' }), ctx({ appFocused: true, viewedPaneId: 'p2' }))
    ).toBe(true);
  });

  it('Mode agent-unfocused, window unfocused', () => {
    expect(
      shouldAlert('agent-unfocused', row({ paneId: 'p1' }), ctx({ appFocused: false, viewedPaneId: 'p1' }))
    ).toBe(true);
  });
});

describe('No alerts for pre-existing waiters at launch', () => {
  it('Agents already waiting at mount', () => {
    // prev = null is the un-primed initial state: the first observation primes
    // the baseline and fires nothing, even for agents already waiting.
    const rows = [
      row({ paneId: 'p1', status: 'waiting' }),
      row({ paneId: 'p2', status: 'error' })
    ];
    expect(newlyNeedsAttention(null, rows)).toEqual([]);
  });

  it('New waiter after priming', () => {
    const primed = attentionIds([row({ paneId: 'p1', status: 'working' })]); // none waiting yet
    const fresh = newlyNeedsAttention(primed, [
      row({ paneId: 'p1', status: 'working' }),
      row({ paneId: 'p2', status: 'waiting' })
    ]);
    expect(fresh.map((r) => r.paneId)).toEqual(['p2']);
  });
});

describe('No alerts before an agent\'s first prompt', () => {
  it('Freshly launched with no prompt', () => {
    // A never-prompted agent (launched with no initial prompt) goes `waiting` at its
    // empty prompt: it is NOT a fresh alert entry, so no channel fires. (It still
    // counts toward the attention lane + baseline — only the alert is withheld.)
    const prev = new Set<string>(); // primed, agent was working/starting
    const fresh = newlyNeedsAttention(prev, [
      row({ paneId: 'p1', status: 'waiting', everPrompted: false })
    ]);
    expect(fresh).toEqual([]);
  });

  it('Alerts resume after the first prompt', () => {
    // Once the agent has been prompted (`everPrompted` true), a fresh entry alerts.
    const prev = new Set<string>();
    const fresh = newlyNeedsAttention(prev, [
      row({ paneId: 'p1', status: 'waiting', everPrompted: true })
    ]);
    expect(fresh.map((r) => r.paneId)).toEqual(['p1']);
  });

  it('Unspecified everPrompted still alerts (legacy/fixtures)', () => {
    // A row that does not carry the signal (undefined) is treated as promptable, so
    // legacy rows / fixtures keep their prior alerting behavior.
    const prev = new Set<string>();
    const fresh = newlyNeedsAttention(prev, [row({ paneId: 'p1', status: 'waiting' })]);
    expect(fresh.map((r) => r.paneId)).toEqual(['p1']);
  });
});

describe('Desktop notification content and permission', () => {
  it('Notification shown with agent context', () => {
    const title = notificationTitle();
    const body = notificationBody(
      row({ name: 'parser', question: 'Which migration strategy should I use?' })
    );
    expect(title.toLowerCase()).toContain('needs input');
    expect(body).toContain('parser');
    expect(body).toContain('Which migration strategy should I use?');
    expect(body).not.toContain('\n'); // one line
  });

  it('Notification uses the generated session title', () => {
    // The pure body identifies the agent by `row.name`; the route resolves that name
    // to the generated session title (falling back to the "Session N" workspace name),
    // so a titled agent reads as its title, never "Session 1".
    const body = notificationBody(row({ name: 'Fix login dialog', question: 'Proceed?' }));
    expect(body).toContain('Fix login dialog');
    expect(body).not.toContain('Session 1');
  });
});
