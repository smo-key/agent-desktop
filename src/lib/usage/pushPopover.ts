// Pure helpers for the push-popover interaction on the footer's ahead (↑) pill.
// Mirrors commitPopover.ts — kept separate from the Svelte component so the
// decision functions are unit-tested apart from the DOM.
//
// The key design decision:
//   pushPopoverOpen — whether a click on the ahead pill should open the popover.
//   The "Push now" action delegates directly to `pushProject` from projectGitActions.

/**
 * Whether a click on the ahead (↑) pill should OPEN the push popover.
 * True only when there are commits to push (ahead > 0) AND a push handler
 * is wired (the footer provides one only when a real project folder is bound).
 * An inert pill (0 ahead, null count, or no handler) must NOT open anything.
 */
export function pushPopoverOpen(
  ahead: number | null | undefined,
  hasPushHandler: boolean
): boolean {
  if (!hasPushHandler) return false;
  return (ahead ?? 0) > 0;
}
