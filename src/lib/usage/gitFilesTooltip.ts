// PURE helper that builds the hover-tooltip text for the footer's uncommitted-
// files (modified) indicator. The indicator lists the changed file PATHS on hover,
// capped at the FIRST 10, with an "…and N more" hint when the tree has more than
// that. Kept pure + exported (no Svelte/Tauri imports) so the content rule is
// unit-tested apart from the component — mirroring footerView / openPrsView.

/** How many file paths the hover tooltip lists before collapsing to a count. */
export const MAX_TOOLTIP_FILES = 10;

/**
 * Build the tooltip text for the uncommitted-files indicator from the changed
 * `files` paths.
 *
 * - No changes (`null` / `undefined` / empty) → `null`: the caller passes this to
 *   `use:tooltip`, and a null/empty text shows NO tooltip (a clean tree must not
 *   pop an empty hint).
 * - ≤ 10 files → one path per line, in order.
 * - > 10 files → the first 10 paths, then a trailing `…and N more` line naming the
 *   number of additional changed files not listed.
 *
 * Each path is on its own line (`\n`) — the tooltip popup renders multi-line text.
 */
export function uncommittedFilesTooltip(files: string[] | null | undefined): string | null {
  if (!files || files.length === 0) return null;
  const shown = files.slice(0, MAX_TOOLTIP_FILES);
  const lines = [...shown];
  const overflow = files.length - shown.length;
  if (overflow > 0) {
    lines.push(`…and ${overflow} more`);
  }
  return lines.join('\n');
}
