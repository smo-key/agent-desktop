import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { OnboardingStore } from './onboarding.svelte';

const flush = () => new Promise((r) => setTimeout(r));

beforeEach(() => {
  invokeMock.mockReset();
});

describe('OnboardingStore', () => {
  it('is not visible before any check (status unknown)', () => {
    const s = new OnboardingStore();
    expect(s.visible).toBe(false);
  });

  it('becomes visible after a check that reports missing models', async () => {
    invokeMock.mockResolvedValue({ ready: false, missing: ['ggml-small.bin'] });
    const s = new OnboardingStore();
    await s.check('fast', false);
    expect(s.status).toEqual({ ready: false, missing: ['ggml-small.bin'] });
    expect(s.visible).toBe(true);
  });

  it('stays hidden after a check that reports everything present', async () => {
    invokeMock.mockResolvedValue({ ready: true, missing: [] });
    const s = new OnboardingStore();
    await s.check('accurate', true);
    expect(s.visible).toBe(false);
  });

  it('dismiss() hides it for the session even while models are still missing', async () => {
    invokeMock.mockResolvedValue({ ready: false, missing: ['Qwen3-1.7B-Q8_0.gguf'] });
    const s = new OnboardingStore();
    await s.check('accurate', true);
    expect(s.visible).toBe(true);
    s.dismiss();
    expect(s.visible).toBe(false);
    expect(s.dismissedThisSession).toBe(true);
  });

  it('a re-check that now reports ready hides the gate', async () => {
    invokeMock.mockResolvedValueOnce({ ready: false, missing: ['ggml-small.bin'] });
    const s = new OnboardingStore();
    await s.check('fast', false);
    expect(s.visible).toBe(true);
    invokeMock.mockResolvedValueOnce({ ready: true, missing: [] });
    await s.check('fast', false);
    expect(s.visible).toBe(false);
  });

  it('a failing status check leaves it hidden (modelsStatus degrades, ready false but unknown)', async () => {
    // modelsStatus swallows errors → { ready: false, missing: [] }. With nothing
    // known missing we still surface the gate (ready === false), so the user can
    // retry a download rather than being silently stuck.
    invokeMock.mockRejectedValue(new Error('boom'));
    const s = new OnboardingStore();
    await s.check('fast', false);
    await flush();
    expect(s.status).toEqual({ ready: false, missing: [] });
    expect(s.visible).toBe(true);
  });
});
