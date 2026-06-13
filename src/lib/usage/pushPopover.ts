// Pure helpers for the push-popover interaction on the footer's ahead (↑) pill.
// Mirrors commitPopover.ts — kept separate from the Svelte component so the
// decision functions are unit-tested apart from the DOM.
//
// The key design decisions:
//   pushPopoverOpen — whether a click on the ahead pill should open the popover.
//     The pill is ALWAYS actionable when a push handler is wired (the user takes
//     the secondary "Push now"/publish action inside the popover in every case),
//     so this is true whenever a handler is present, regardless of the ahead count.
//   aheadPillEnabled — whether the pill should read as HIGHLIGHTED (something to
//     do) vs the neutral empty state (nothing to do).
//   The "Push now" action delegates directly to `pushProject` from projectGitActions.

/**
 * Whether a click on the ahead (↑) pill should OPEN the push popover.
 * True whenever a push handler is wired (the footer provides one only when a real
 * project folder is bound). The popover appears in ALL cases — listing the commits
 * to push, or offering to publish/confirm when there are none — so the user always
 * takes the secondary action there rather than the pill pushing on click.
 */
export function pushPopoverOpen(hasPushHandler: boolean): boolean {
  return hasPushHandler;
}

/**
 * Whether the ahead (↑) pill should render in its HIGHLIGHTED ("something to do")
 * state vs the neutral empty state (which mimics the open-PRs zero state).
 *
 * Highlighted when there is a known count AND either there are commits to push
 * (`ahead > 0`) OR the branch is unpublished (`upstream === false`, so pushing
 * would publish it — even at zero commits). Neutral when the branch is published
 * and fully in sync (`ahead === 0`, `upstream === true`), or when the count is
 * unknown (`ahead == null` — e.g. no remote to push to).
 */
export function aheadPillEnabled(
  ahead: number | null | undefined,
  upstream: boolean | null | undefined
): boolean {
  if (ahead == null) return false;
  return ahead > 0 || upstream === false;
}
