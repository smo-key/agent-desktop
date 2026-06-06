// PURE bar-color helper for the persistent footer. Maps a 0..100 "fill" percent
// to a status color token by how FULL it is: a fuller bar is closer to its limit
// and so escalates green -> yellow -> red. Framework-free (no Svelte/Tauri), so
// it is unit-tested in barColor.test.ts. Thresholds live here as the single
// tweakable source of truth, shared by the limit bars and the context bar.

/** A fill at or above this percent is YELLOW (caution). */
export const BAR_YELLOW_AT = 50;
/** A fill at or above this percent is RED (abort). */
export const BAR_RED_AT = 80;

/**
 * The CSS color (a design-token `var(...)`) for a fill percent: green below
 * `BAR_YELLOW_AT`, yellow up to `BAR_RED_AT`, red at/above it. A null or
 * non-finite percent (unknown) renders as the neutral track color.
 */
export function barColor(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return 'var(--space-600)';
  if (pct >= BAR_RED_AT) return 'var(--abort-500)';
  if (pct >= BAR_YELLOW_AT) return 'var(--caution-500)';
  return 'var(--nominal-500)';
}
