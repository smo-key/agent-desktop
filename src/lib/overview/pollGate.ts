// PURE policy for the route's background pollers while the window is hidden and
// right after the machine wakes from sleep.
//
// Hidden: nothing is on screen, so purely visual polls (project git status, the
// remote fetch) PAUSE, and the correctness backstops (transcript safety poll,
// event re-seed) run at a fraction of their rate — not zero, because a
// needs-input alert must still fire for a backgrounded app when a live event
// push was missed.
//
// Wake: timers do not run while the machine sleeps, so the first heartbeat after
// a wake observes a gap far larger than its interval. On a wake everything
// refreshes once, immediately, except the network fetch, which waits for the
// network to come back instead of burning its timeout on every project at once.

/** `null` = paused while hidden; `n` = run every nth tick while hidden. */
export type HiddenPolicy = number | null;

/** Should this interval tick do its work? Always when visible. */
export function shouldRunTick(tick: number, visible: boolean, hidden: HiddenPolicy): boolean {
  if (visible) return true;
  if (hidden === null || hidden <= 0) return false;
  return tick % hidden === 0;
}

/** A heartbeat gap this much larger than its interval means the machine slept. */
export const WAKE_GAP_MS = 10_000;

/** Did the heartbeat skip enough time to have been asleep (not merely throttled)? */
export function isWakeGap(prevMs: number, nowMs: number, intervalMs: number): boolean {
  return nowMs - prevMs - intervalMs >= WAKE_GAP_MS;
}

/** How long the remote fetch waits after a wake for the network to return. */
export const WAKE_FETCH_DELAY_MS = 8_000;

/** Is `nowMs` still inside the post-wake window in which a fetch must not start? */
export function inWakeFetchHold(lastWakeMs: number | null, nowMs: number): boolean {
  return lastWakeMs !== null && nowMs - lastWakeMs < WAKE_FETCH_DELAY_MS;
}
