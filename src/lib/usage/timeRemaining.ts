// PURE helpers for the footer's rate-limit cells (LimitBars). `timeRemainingShort`
// formats the time LEFT until a window resets as a compact single-unit shorthand —
// "12M"/"5H"/"6D", or "—" when unknown/elapsed — shown in place of the raw used
// percentage. `resetClause` / `usageLimitTooltip` build the bar's TOOLTIP, which
// spells out the used percent and the ABSOLUTE local reset time (date + time when
// it falls on a different day). Framework-free (the locale formatter is injectable),
// unit-tested in timeRemaining.test.ts.

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

/** Locale-aware clock/date formatters, injectable so the pure helpers below stay
 *  testable (a stub avoids locale/timezone drift in unit tests). The default renders
 *  in the user's locale + local timezone — what they actually see in the footer. */
export interface ClockFormat {
  /** A bare time-of-day, e.g. "3:45 PM". */
  time: (d: Date) => string;
  /** A short calendar date (no year), e.g. "Jun 12". */
  date: (d: Date) => string;
}

/** The default user-local formatter (locale + timezone from the environment). */
export const DEFAULT_CLOCK: ClockFormat = {
  time: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  date: (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
};

/**
 * The "when does this window reset" clause for a tooltip, as an ABSOLUTE local
 * time: "resets at 3:45 PM" when the reset is later TODAY, or "resets Jun 12 at
 * 3:45 PM" when it falls on a different calendar day (so a far-off 7-day reset is
 * unambiguous). A null/non-finite `resetsAt` returns null so the caller can omit
 * the clause. The same-day test and string composition are PURE given `fmt`.
 */
export function resetClause(
  resetsAt: number | null,
  nowSeconds: number,
  fmt: ClockFormat = DEFAULT_CLOCK
): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null;
  const when = new Date(resetsAt * 1000);
  const now = new Date(nowSeconds * 1000);
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  return sameDay
    ? `resets at ${fmt.time(when)}`
    : `resets ${fmt.date(when)} at ${fmt.time(when)}`;
}

/**
 * The footer rate-limit tooltip text for one window: the used percentage, then —
 * when the reset time is known — WHEN the window resets as an absolute local time,
 * e.g. "5-hour limit — 33% used · resets at 3:45 PM". With an unknown reset the
 * clause is dropped: "5-hour limit — 33% used". Pure given `fmt`; unit-tested.
 */
export function usageLimitTooltip(
  name: string,
  usedPct: number | null,
  resetsAt: number | null,
  nowSeconds: number,
  fmt: ClockFormat = DEFAULT_CLOCK
): string {
  const used = usedPct === null || !Number.isFinite(usedPct) ? '—' : `${Math.round(usedPct)}%`;
  const base = `${name} limit — ${used} used`;
  const clause = resetClause(resetsAt, nowSeconds, fmt);
  return clause ? `${base} · ${clause}` : base;
}
