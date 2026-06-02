// Thin message-an-agent dispatcher for the agent-overview surface (Stage 1,
// tasks.md 10.4; spec: Message An Agent). It looks up the target pane's terminal
// handle and hands it the user's text via `handle.send(text)` — which writes that
// EXACT text plus a single carriage return to the PTY through the existing
// `pty_write` path. The dispatcher NEVER synthesizes input: it sends only the
// user's text, and an empty/blank message sends nothing at all (it does not
// invent a slash command or any other input on the user's behalf — spec: "Only
// user-entered text is ever sent").
//
// The registry lookup is injected (defaulting to the real `getTerminal`) so the
// dispatch is pure-ish and unit-testable against a fake registry, with no Svelte/
// Tauri/xterm wiring in the test.

import { getTerminal, type TerminalHandle } from '../layout/terminals';

/** A registry lookup: pane id -> its live terminal handle (or undefined). */
export type HandleLookup = (paneId: string) => TerminalHandle | undefined;

/**
 * Send the user's `text` to the agent in pane `paneId`. Returns whether anything
 * was sent:
 *
 *  - Returns `false` (a no-op) when `text` is empty/blank — the dispatcher never
 *    synthesizes input on the user's behalf, so there is nothing to deliver.
 *  - Returns `false` when no handle is registered for `paneId` (its session ended
 *    or never mounted) — never throws.
 *  - Otherwise hands the EXACT, VERBATIM text to `handle.send` (which appends the
 *    single carriage return as it writes to the PTY) and returns whatever `send`
 *    reports: `true` when it wrote to a live PTY, `false` when the pane's process
 *    has exited (so a dead agent never yields a false success). A message that
 *    begins with `/` is the USER's text and is passed through unchanged.
 *
 * @param paneId  the target pane (the snapshot/roster key)
 * @param text    the user-entered message (sent verbatim)
 * @param lookup  the registry lookup (defaults to the real terminal registry)
 */
export function messageAgent(
  paneId: string,
  text: string,
  lookup: HandleLookup = getTerminal
): boolean {
  // Never synthesize input: an empty/blank message delivers nothing.
  if (text.trim().length === 0) return false;
  const handle = lookup(paneId);
  if (!handle) return false;
  // Return whatever `send` reports: false when the pane's PTY is dead (process
  // exited), so the caller never reports a false success against a dead agent.
  return handle.send(text);
}
