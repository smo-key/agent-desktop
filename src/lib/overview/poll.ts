// PURE policy for event-driven transcript reads (activity-timeline, design D4).
//
// Transcript CONTENT (the last assistant message + context %) is read by the Rust
// `activity_for` command. Instead of a fixed fast poll, the route triggers a read
// in response to the events that mean "the visible content just changed" — a tool
// completing or a turn ending — and keeps only a slow SAFETY poll as a backstop
// for any event that never arrived (e.g. the socket was briefly down).

/** The hook events after which the transcript's visible content may have changed
 *  and is worth re-reading: a tool completed, or a turn/subturn ended. */
export const TRANSCRIPT_READ_EVENTS: ReadonlySet<string> = new Set([
  'PostToolUse',
  'Stop',
  'SubagentStop'
]);

/** Slow safety-poll interval (ms): the backstop that re-reads transcript content
 *  even if no triggering event arrived. Much slower than the retired 1.5s fast
 *  poll — events do the timely work now; this only covers missed pushes. */
export const SAFETY_POLL_MS = 5000;

/** PURE: whether an incoming event should trigger an immediate transcript read. */
export function triggersTranscriptRead(eventName: string): boolean {
  return TRANSCRIPT_READ_EVENTS.has(eventName);
}
