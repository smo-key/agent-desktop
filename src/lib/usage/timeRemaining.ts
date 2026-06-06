// PURE helper: format the time left until a rate-limit window resets as a compact
// single-unit shorthand — "12M" (minutes), "5H" (hours), "6D" (days), or "—" when
// unknown/elapsed. Framework-free (no Svelte/Tauri), unit-tested in
// timeRemaining.test.ts. The footer's LimitBars renders this in place of the raw
// used-percentage so the 5h/7d cells read as "time remaining".

/**
 * Compact time-remaining label from `resetsAt` (unix SECONDS) and `nowSeconds`.
 * Returns the LARGEST single unit: minutes (`<1h`), hours (`<1d`), else days,
 * uppercased (M/H/D). Minutes never round down to 0 (a few seconds left → "1M").
 * A null/non-finite `resetsAt`, or one already elapsed, returns "—".
 */
export function timeRemainingShort(resetsAt: number | null, nowSeconds: number): string {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return '—';
  const diff = resetsAt - nowSeconds;
  if (!Number.isFinite(diff) || diff <= 0) return '—';
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}M`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}H`;
  return `${Math.floor(diff / 86400)}D`;
}
