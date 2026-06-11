import { describe, it, expect } from 'vitest';
import { shouldShowOnboarding } from './onboarding.svelte';
import type { ModelsStatus } from '$lib/voice/models';

// Pure gate: show the first-launch model onboarding at most ONCE per user. It is
// shown only when we KNOW the required models are missing, the user hasn't seen it
// before (persisted), and hasn't dismissed it this session.

const status = (ready: boolean, missing: string[] = []): ModelsStatus => ({ ready, missing });

describe('shouldShowOnboarding', () => {
  it('does not show before status is known (null) — avoids a flash on boot', () => {
    expect(shouldShowOnboarding(null, false, false)).toBe(false);
  });

  it('shows when models are missing, not seen, and not dismissed', () => {
    expect(shouldShowOnboarding(status(false, ['ggml-small.bin']), false, false)).toBe(true);
  });

  it('does not show when all required models are present', () => {
    expect(shouldShowOnboarding(status(true), false, false)).toBe(false);
  });

  it('does not show when dismissed for the session, even if still missing', () => {
    expect(shouldShowOnboarding(status(false, ['ggml-small.bin']), true, false)).toBe(false);
  });

  it('does not show once seen before, even if missing and not dismissed', () => {
    expect(shouldShowOnboarding(status(false, ['ggml-small.bin']), false, true)).toBe(false);
  });

  it('does not show once seen before, regardless of status (no flash for returning users)', () => {
    expect(shouldShowOnboarding(null, false, true)).toBe(false);
  });
});
