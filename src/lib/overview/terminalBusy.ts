// PURE detection of Claude Code "actively working" affordances in recent terminal
// output (agent-status-derivation). The agent-overview status is event-hook
// driven, but those hooks report idle while Claude Code is still doing work that
// does NOT round-trip through the hook pipeline:
//
//   (a) a FOREGROUND command running in the terminal — Claude renders a spinner
//       line with the "esc to interrupt" / "ctrl+b to run in background"
//       affordance (e.g. a bash-mode `! <cmd>` run, or a long tool call), and
//   (b) in-session BACKGROUND work — a dynamic workflow or another agent still
//       running after the main agent's turn returned, shown as
//       "Waiting for N dynamic workflow(s) to finish".
//
// In both states the agent is In flight, not Needs input. This helper scans a
// bounded tail of recent terminal text for those affordances so the roster can
// keep the agent In flight until the work finishes or the user interrupts it.
//
// Framework-free (no Svelte/Tauri/xterm imports) so it is trivially unit-tested
// with sample TUI text. Deliberately a small, robust signal set — see the
// matchers below. Fail-safe: ANY non-match (incl. empty text) returns false, so
// a quiet idle prompt is never mistaken for working.

/**
 * Strong, specific affordance strings (matched case-insensitively as substrings)
 * that ONLY appear while Claude Code has a foreground operation in flight. The
 * interrupt/background hints are part of the running-spinner line.
 */
const FOREGROUND_RUN_MARKERS: readonly string[] = [
  'esc to interrupt',
  'ctrl+b to run in background'
];

/**
 * In-session background work: the main turn returned but a dynamic workflow (or
 * another agent) is still running. The count is dynamic, so a regex pins the
 * shape "Waiting for <digits> dynamic workflow(s)" — a digit + the phrase, so
 * generic "Waiting for ..." prose never trips it.
 */
const BACKGROUND_WORKFLOW_RE = /waiting for \d+ dynamic workflow/i;

/**
 * PURE: does the recent terminal text show Claude Code actively working?
 *
 * Returns true when ANY active-work affordance is present:
 *  - a foreground run ("esc to interrupt" / "ctrl+b to run in background"), or
 *  - in-session background work ("Waiting for N dynamic workflow(s) to finish").
 *
 * Otherwise false — including for empty/whitespace text and an idle prompt — so
 * the consuming override is strictly additive (no indicator → behave as before).
 * Never throws.
 *
 * @param recentText a bounded tail of recent terminal output (rendered text)
 */
export function detectTerminalBusy(recentText: string): boolean {
  if (!recentText) return false;
  const haystack = recentText.toLowerCase();
  for (const marker of FOREGROUND_RUN_MARKERS) {
    if (haystack.includes(marker)) return true;
  }
  return BACKGROUND_WORKFLOW_RE.test(recentText);
}
