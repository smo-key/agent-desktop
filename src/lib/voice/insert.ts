// The voice INSERTION primitive (tasks.md 8.1 + 8.2; spec: "Verbatim insertion
// into the focused agent terminal"). When dictation finishes, the final text is
// inserted VERBATIM into the currently focused agent's terminal — WITHOUT a
// trailing carriage return (NO auto-submit), so the user can review the text and
// press Enter themselves.
//
// The pure logic lives here (no Svelte/Tauri imports) so the load-bearing
// guarantees are unit-tested without a DOM or a live PTY:
//   - never append `\r` (the test asserts the exact bytes handed to the handle)
//   - never transform the text (multi-line passes through byte-for-byte)
//   - a missing target yields a clear `no-target` result, never a silent send to
//     an unexpected pane.
//
// INSERTION METHOD — `sendKeys`, NOT `send`/`paste`:
//   - `send(text)` appends a single `\r` (it is the "message an agent" submit
//     path) — using it would AUTO-SUBMIT the dictation, which the spec forbids.
//   - `paste(text)` writes raw bytes too, but its handle returns `void` (no
//     live/dead PTY signal) and is reserved for the context-menu paste; it
//     gives us no way to detect a dead pane. (TerminalPane's `paste` does NOT
//     wrap the text in xterm bracketed-paste markers — it is a plain `pty_write`
//     — so it offers no "treat as pasted, don't submit" advantage over
//     `sendKeys` for a TUI.)
//   - `sendKeys(data)` writes the EXACT bytes VERBATIM with NO trailing CR and
//     returns `false` when the pane's PTY has exited — exactly what we need to
//     insert (possibly multi-line) text without submitting and to report a dead
//     pane. So `sendKeys` is the chosen primitive.

import { getTerminal, type TerminalHandle } from '../layout/terminals';
import { workspace } from '../layout/workspace.svelte';
import { voiceStore } from './voiceStore.svelte';

/** The outcome of attempting to insert dictated text into a terminal. */
export type InsertResult = { ok: true } | { ok: false; reason: 'no-target' | 'dead-pane' };

/**
 * Insert `text` VERBATIM into `handle`'s terminal with NO auto-submit.
 *
 *  - `handle` undefined (no focused agent terminal) -> `{ ok: false, reason: 'no-target' }`.
 *  - empty / whitespace-only `text` -> `{ ok: true }` (a no-op success: there IS
 *    a target, but nothing to insert — never write, never surface an error).
 *  - otherwise write the EXACT text via `sendKeys` (raw, no trailing `\r`, no
 *    transformation): if it returns `false` (the pane's process has exited) ->
 *    `{ ok: false, reason: 'dead-pane' }`, else `{ ok: true }`.
 *
 * The text is handed to `sendKeys` UNCHANGED — no carriage return is appended and
 * the bytes (including any newlines in multi-line dictation) are never rewritten.
 */
export function insertVoiceText(
  handle: TerminalHandle | undefined,
  text: string
): InsertResult {
  if (!handle) return { ok: false, reason: 'no-target' };
  // Nothing to insert: a no-op success (never synthesize input, never error on a
  // valid target that simply received blank dictation).
  if (text.trim().length === 0) return { ok: true };
  // VERBATIM, NO carriage return: `sendKeys` writes the exact bytes and reports
  // false only when the PTY is dead.
  const wrote = handle.sendKeys(text);
  return wrote ? { ok: true } : { ok: false, reason: 'dead-pane' };
}

/** A registry lookup: pane id -> its live terminal handle (or undefined). */
export type HandleLookup = (paneId: string) => TerminalHandle | undefined;

/**
 * Resolve the focused agent's `paneId` to its terminal handle via the injected
 * `lookup` (so this step is testable without the real registry). A null/empty
 * `focusedPaneId` (nothing focused) resolves to `undefined`.
 */
export function resolveFocusedAgentHandle(
  focusedPaneId: string | null,
  lookup: HandleLookup
): TerminalHandle | undefined {
  if (!focusedPaneId) return undefined;
  return lookup(focusedPaneId);
}

/**
 * The currently focused AGENT pane id, or `null` when none is focused.
 *
 * Source of truth: `workspace.focusedId` (the active workspace's focused leaf).
 * The inbox/overview makes the selected agent the active workspace's focused leaf
 * (`setFocusIn`), and in the grid the focused leaf is the agent you are driving —
 * so this single value is "which agent pane is focused right now". Project
 * terminals live in a separate panel, not in the workspace tree, so they are
 * never returned here.
 *
 * Thin, untested wrapper (it reads the live store); all logic stays in the pure
 * functions above. Guarded so it is `null` before `init` (no active workspace).
 */
export function focusedAgentPaneId(): string | null {
  try {
    return workspace.focusedId || null;
  } catch {
    // No active workspace yet (pre-init): treat as "nothing focused".
    return null;
  }
}

/** Clear, user-facing message when there is no agent terminal to receive dictation. */
export const NO_TARGET_MESSAGE = 'No focused agent to receive dictation';

/**
 * The entry point the voice pipeline calls when dictation finishes: resolve the
 * currently focused agent pane, look up its terminal, and insert `text` verbatim
 * (NO auto-submit). On `no-target` it sets a clear error state on `voiceStore` so
 * the panel can show the "no target" state; on a live insert it succeeds quietly.
 *
 * `lookup` and `getFocusedPaneId` are injectable so the resolution is testable;
 * they default to the real registry + workspace store.
 */
export function insertDictation(
  text: string,
  lookup: HandleLookup = getTerminal,
  getFocusedPaneId: () => string | null = focusedAgentPaneId
): InsertResult {
  const handle = resolveFocusedAgentHandle(getFocusedPaneId(), lookup);
  const result = insertVoiceText(handle, text);
  if (!result.ok && result.reason === 'no-target') {
    voiceStore.setError(NO_TARGET_MESSAGE);
  }
  return result;
}
