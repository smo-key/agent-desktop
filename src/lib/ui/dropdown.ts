// Pure keyboard-navigation helper for `Dropdown.svelte`, split out so the roving
// highlight math is unit-tested without a rendered component (the repo tests pure
// logic only). Given the currently-highlighted option index, a key, and the option
// count, return the next highlighted index — clamped within bounds (no wrap).

/** PURE: the next highlighted option index for a navigation key, clamped to
 *  `[0, count - 1]` (or `-1` when there are no options). Down/Up step by one and
 *  clamp at the ends; Home/End jump to the first/last; any other key is a no-op. */
export function rovingIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1;
  switch (key) {
    case 'ArrowDown':
      return Math.min(current + 1, last);
    case 'ArrowUp':
      return Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return current;
  }
}
