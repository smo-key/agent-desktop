import { describe, it, expect } from 'vitest';
import { shouldShowOnboarding } from './onboarding.svelte';
import type { ModelsStatus } from '$lib/voice/models';

// Pure gate: show the first-launch model onboarding only once we KNOW the required
// models are missing and the user hasn't dismissed it for this session.

const status = (ready: boolean, missing: string[] = []): ModelsStatus => ({ ready, missing });

describe('shouldShowOnboarding', () => {
  it('does not show before status is known (null) — avoids a flash on boot', () => {
    expect(shouldShowOnboarding(null, false)).toBe(false);
  });

  it('shows when models are missing and not dismissed', () => {
    expect(shouldShowOnboarding(status(false, ['ggml-small.bin']), false)).toBe(true);
  });

  it('does not show when all required models are present', () => {
    expect(shouldShowOnboarding(status(true), false)).toBe(false);
  });

  it('does not show when dismissed for the session, even if still missing', () => {
    expect(shouldShowOnboarding(status(false, ['ggml-small.bin']), true)).toBe(false);
  });
});
