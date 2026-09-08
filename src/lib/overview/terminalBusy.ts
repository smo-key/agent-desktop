// PURE detection of an agent's "actively working" affordances in recent
// terminal output (agent-status-derivation). The agent-overview status is
// event-driven, but events can report idle while the agent is still doing work
// that does not round-trip through the event pipeline (e.g. a foreground
// command running in the terminal, or in-session background work). This helper
// scans a bounded tail of recent terminal text for the BACKEND-DECLARED
// affordance strings so the roster can keep the agent In flight until the work
// finishes or the user interrupts it.
//
// The marker set comes from the pane's backend descriptor (`$lib/agent/backends`
// — agent-backends: Busy markers resolved per backend): claude declares its
// spinner affordances ("esc to interrupt" / "ctrl+b to run in background") and
// the dynamic "Waiting for N dynamic workflow(s)" pattern; copilot declares an
// EMPTY set — its events tailer is authoritative, and unverified TUI strings
// are never guessed. Fail-safe: ANY non-match (incl. empty text and non-agent
// programs) returns false, so a quiet idle prompt is never mistaken for working.
//
// Kept framework-free (no Svelte/Tauri/xterm imports) so it is trivially
// unit-tested with sample TUI text.

import { backendForProgram } from '$lib/agent/backends';

/**
 * PURE: does the recent terminal text show the agent actively working?
 *
 * The marker set comes from the pane's BACKEND DESCRIPTOR (agent-backends:
 * Busy markers resolved per backend): claude declares its spinner affordances
 * ("esc to interrupt" / "ctrl+b to run in background") plus the dynamic
 * "Waiting for N dynamic workflow(s)" pattern; copilot declares an EMPTY set —
 * its events tailer is authoritative and unverified TUI strings are never
 * guessed. A non-agent program yields false always.
 *
 * Otherwise false — including for empty/whitespace text and an idle prompt — so
 * the consuming override is strictly additive (no indicator → behave as before).
 * Never throws.
 *
 * @param recentText a bounded tail of recent terminal output (rendered text)
 * @param program    the pane's program; defaults to `claude` (legacy callers)
 */
export function detectTerminalBusy(recentText: string, program: string = 'claude'): boolean {
  if (!recentText) return false;
  const backend = backendForProgram(program);
  if (!backend) return false;
  const haystack = recentText.toLowerCase();
  for (const marker of backend.busyMarkers) {
    if (haystack.includes(marker)) return true;
  }
  return backend.busyPatterns.some((re) => re.test(recentText));
}
