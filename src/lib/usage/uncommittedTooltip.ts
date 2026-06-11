// PURE helper that builds the hover-tooltip text for the footer's uncommitted-
// files (modified) indicator. Shows only the COUNT of changed files — concise,
// so the popover (which lists the paths) can be opened by clicking the pill.
// Kept pure + exported (no Svelte/Tauri imports) so it is trivially unit-tested.

/**
 * Build a count-only tooltip string for the uncommitted-files indicator:
 * - 1 → `"1 uncommitted file"` (singular)
 * - 0 / N → `"N uncommitted files"` (plural)
 *
 * Always returns a string (never null) — callers decide whether to pass it to
 * `use:tooltip` based on whether the count is > 0.
 */
export function uncommittedCountTooltip(n: number): string {
  return `${n} uncommitted file${n === 1 ? '' : 's'}`;
}
