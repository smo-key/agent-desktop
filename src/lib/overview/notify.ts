// PURE needs-input-alerts core (capability `needs-input-alerts`). Given the live
// roster, decides WHICH agents have just entered the "Needs input" state and, for
// each alert channel (sound / desktop), whether that channel should fire — purely
// from the channel's mode + the OS-window-focus / currently-viewed-agent context.
//
// Framework-free (no Svelte/Tauri/browser imports) so it is trivially unit-tested.
// `alerts.svelte.ts` is the thin reactive shell that holds the previous-attention
// baseline, reads the live prefs + focus, calls this core, and performs the side
// effects (the chime + the Tauri notification).

import { needsAttention, type AgentRow } from './roster';
import { clipLine } from './inbox';

/**
 * A single alert channel's mode — when that channel fires on an agent entering
 * "Needs input", in an escalating ladder (each alerts at least as often as the
 * previous):
 *  - `off`             — never alert on this channel (its disabled state).
 *  - `app-unfocused`   — only when the app window does NOT have OS focus.
 *  - `agent-unfocused` — unless you are actively viewing that exact agent in a
 *                        focused window (i.e. alert when unfocused OR viewing else).
 *  - `always`          — every entry, regardless of focus or viewed agent.
 */
export type AlertMode = 'off' | 'app-unfocused' | 'agent-unfocused' | 'always';

/** The two channel modes, persisted as the `notifications` settings slice. */
export interface NotificationPrefs {
  /** The sound-chime channel. */
  sound: { mode: AlertMode };
  /** The OS desktop-notification channel. */
  desktop: { mode: AlertMode };
}

/** The focus context an alert decision is taken against. */
export interface AlertContext {
  /** Whether the Agent Desktop window currently has OS focus (and is visible). */
  appFocused: boolean;
  /** The paneId of the agent the user is currently viewing (inbox focus agent in
   *  overview, or the active grid pane), or null when none. */
  viewedPaneId: string | null;
}

/**
 * PURE: the set of paneIds currently in "Needs input" (`needsAttention`). This is
 * the baseline the reactive shell stores between recomputes; the next recompute
 * diffs against it to find fresh entries.
 */
export function attentionIds(rows: AgentRow[]): Set<string> {
  return new Set(rows.filter((r) => needsAttention(r)).map((r) => r.paneId));
}

/**
 * PURE: the rows that have JUST entered "Needs input" and should ALERT — those
 * `needsAttention` now but absent from `prev`. `prev === null` is the un-primed
 * initial state: the very first observation primes the baseline and returns NOTHING,
 * so agents already waiting when the app/inbox mounts never alert. Only entries seen
 * AFTER priming are returned.
 *
 * A row that has NEVER been prompted (`everPrompted === false`) is excluded: an agent
 * launched with no initial prompt sits `waiting` at its empty prompt, and you just
 * launched it yourself, so alerting there is pure noise. This gates the ALERTS only —
 * such an agent still surfaces in the attention lane (via `needsAttention`) and is
 * still folded into the caller's baseline (`attentionIds`), so once it HAS been
 * prompted a later entry into "Needs input" alerts normally. A row that does not carry
 * the signal (`undefined`) is treated as promptable, preserving legacy/fixture
 * behavior. Preserves roster order; never mutates inputs.
 */
export function newlyNeedsAttention(
  prev: ReadonlySet<string> | null,
  rows: AgentRow[]
): AgentRow[] {
  if (prev === null) return [];
  return rows.filter(
    (r) => needsAttention(r) && !prev.has(r.paneId) && r.everPrompted !== false
  );
}

/**
 * PURE: whether a channel with the given `mode` should alert for `row`'s entry into
 * "Needs input", under the focus context:
 *  - `off`             → false
 *  - `always`          → true
 *  - `app-unfocused`   → the app window is not focused
 *  - `agent-unfocused` → NOT (the app is focused AND you are viewing this exact agent)
 */
export function shouldAlert(mode: AlertMode, row: AgentRow, ctx: AlertContext): boolean {
  switch (mode) {
    case 'off':
      return false;
    case 'always':
      return true;
    case 'app-unfocused':
      return !ctx.appFocused;
    case 'agent-unfocused':
      return !(ctx.appFocused && ctx.viewedPaneId === row.paneId);
  }
}

/**
 * PURE: which channels should fire for one newly-attention row — each channel's own
 * mode decides independently, so sound and desktop are fully decoupled.
 */
export function channelsToAlert(
  prefs: NotificationPrefs,
  row: AgentRow,
  ctx: AlertContext
): { sound: boolean; desktop: boolean } {
  return {
    sound: shouldAlert(prefs.sound.mode, row, ctx),
    desktop: shouldAlert(prefs.desktop.mode, row, ctx)
  };
}

/**
 * PURE: the desktop notification title for a row — "<Project Name>: <Agent Title>".
 * The Agent Title is `row.name` (resolved at the callsite to the generated session
 * title, falling back to the workspace/cwd name). The Project Name is `row.projectName`
 * (resolved at the callsite from `row.projectId`); when the agent has no project the
 * title is the Agent Title alone, with no prefix or separator.
 */
export function notificationTitle(row: AgentRow): string {
  return row.projectName ? `${row.projectName}: ${row.name}` : row.name;
}

/**
 * PURE: the desktop notification body for a row — the agent's most recently sent
 * message, collapsed to one clipped line: its pending question when waiting on one,
 * else its last assistant message. The agent's name is NOT included (it lives in the
 * title). Falls back to a generic needs-input prompt when there is no question/summary.
 */
export function notificationBody(row: AgentRow): string {
  const question =
    row.questions && row.questions.length > 0 ? row.questions[0].question : row.question;
  const detail = clipLine(question) ?? clipLine(row.summary);
  return detail ?? 'Needs your input';
}
