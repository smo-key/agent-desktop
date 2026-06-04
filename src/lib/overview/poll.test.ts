import { describe, expect, it } from 'vitest';
import { SAFETY_POLL_MS, triggersTranscriptRead } from './poll';

// Pure poll-policy test (activity-timeline). The title matches the spec scenario
// "Content refreshed on stop"; the two live route-interval behaviors ("Safety poll
// backstops missed events", "Fixed fast poll removed") are headless-exempt MANUAL.

describe('transcript-read policy', () => {
  it('Content refreshed on stop', () => {
    // A turn ending / a tool completing triggers an immediate transcript read.
    expect(triggersTranscriptRead('Stop')).toBe(true);
    expect(triggersTranscriptRead('PostToolUse')).toBe(true);
    expect(triggersTranscriptRead('SubagentStop')).toBe(true);
    // An in-flight or lifecycle-only event does NOT (status/timeline already cover it).
    expect(triggersTranscriptRead('PreToolUse')).toBe(false);
    expect(triggersTranscriptRead('SessionStart')).toBe(false);
    expect(triggersTranscriptRead('Notification')).toBe(false);
    // The safety backstop is far slower than the retired 1.5s fast poll.
    expect(SAFETY_POLL_MS).toBeGreaterThan(1500);
  });
});
