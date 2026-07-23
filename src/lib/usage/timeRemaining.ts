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
 * unambiguous). Returns null (caller omits the clause) when there is no known FUTURE
 * reset: a null/non-finite `resetsAt`, OR one that is not still ahead of `nowSeconds`
 * (already elapsed, or a 0/epoch/stale value) — which would otherwise render a
 * misleading past or 1969-epoch clock time. This matches `timeRemainingShort`, which
 * shows "—" for the same inputs. The same-day test and string composition are PURE
 * given `fmt`.
 */
export function resetClause(
  resetsAt: number | null,
  nowSeconds: number,
  fmt: ClockFormat = DEFAULT_CLOCK
): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt) || resetsAt <= nowSeconds) return null;
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

/** One named rate-limit window, as the reset-countdown helpers consume it. */
export interface ResetWindow {
  /** Human label for the window, e.g. "5-hour" / "7-day". */
  name: string;
  /** When it resets (unix SECONDS), or null when unknown. */
  resetsAt: number | null;
}

/**
 * PURE: the window that resets SOONEST among `windows` — the smallest `resetsAt`
 * still ahead of `nowSeconds`. Windows with a null / non-finite / already-elapsed
 * reset are ignored. Returns null when none has a known future reset.
 */
export function nextReset(windows: ResetWindow[], nowSeconds: number): ResetWindow | null {
  let best: ResetWindow | null = null;
  for (const w of windows) {
    if (w.resetsAt === null || !Number.isFinite(w.resetsAt) || w.resetsAt <= nowSeconds) continue;
    if (best === null || (w.resetsAt as number) < (best.resetsAt as number)) best = w;
  }
  return best;
}

/**
 * PURE: a live countdown label to a reset — "resets in 4h 32m" / "resets in 47m" /
 * "resets in 2d 3h" (largest two units, trailing zero unit dropped; minutes floor
 * to a minimum of "1m"). Returns null for a null / non-finite / already-elapsed
 * `resetsAt`, so the caller hides the metric — matching `timeRemainingShort`.
 */
export function resetCountdownLabel(resetsAt: number | null, nowSeconds: number): string | null {
  if (resetsAt === null || !Number.isFinite(resetsAt)) return null;
  // Gate on the RAW (unfloored) remaining seconds so this exclusion matches
  // `nextReset`'s (`resetsAt <= now`) exactly — a fractional reset within the
  // current second still yields a label ("resets in 1m") instead of the two
  // helpers disagreeing and hiding the metric.
  if (resetsAt - nowSeconds <= 0) return null;
  let diff = Math.floor(resetsAt - nowSeconds);
  const days = Math.floor(diff / 86400);
  diff -= days * 86400;
  const hours = Math.floor(diff / 3600);
  diff -= hours * 3600;
  const mins = Math.floor(diff / 60);
  let body: string;
  if (days > 0) body = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  else if (hours > 0) body = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  else body = `${Math.max(1, mins)}m`;
  return `resets in ${body}`;
}

/**
 * PURE: the footer reset-countdown metric — a `{ label, tooltip }` for the window
 * that resets soonest among `windows`, or null when none has a known future reset
 * (the caller then renders nothing). `label` is the relative countdown
 * (`resetCountdownLabel`); `tooltip` names the window and its absolute reset time,
 * e.g. "5-hour limit · resets at 3:45 PM". Pure given `fmt`; unit-tested.
 */
export function nextResetCountdown(
  windows: ResetWindow[],
  nowSeconds: number,
  fmt: ClockFormat = DEFAULT_CLOCK
): { label: string; tooltip: string } | null {
  const w = nextReset(windows, nowSeconds);
  if (w === null) return null;
  const label = resetCountdownLabel(w.resetsAt, nowSeconds);
  if (label === null) return null;
  const clause = resetClause(w.resetsAt, nowSeconds, fmt);
  const tooltip = clause ? `${w.name} limit · ${clause}` : `${w.name} limit`;
  return { label, tooltip };
}
