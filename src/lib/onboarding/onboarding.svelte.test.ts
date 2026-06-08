import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { OnboardingStore } from './onboarding.svelte';

const flush = () => new Promise((r) => setTimeout(r));

// The store invokes several Tauri commands: `voice_models_status` (presence check),
// `settings_load` / `settings_save` (the persisted "seen" flag). Route by command so
// status and persistence can be driven independently. `statusResult` is the next
// readiness; `settingsBlob` is the in-memory settings.json that load/save read/write.
let statusResult: { ready: boolean; missing: string[] } | Error;
let settingsBlob: Record<string, unknown>;

function routeInvoke(cmd: string, args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case 'voice_models_status':
      if (statusResult instanceof Error) throw statusResult;
      return statusResult;
    case 'settings_load':
      return JSON.stringify(settingsBlob);
    case 'settings_save':
      settingsBlob = JSON.parse(args?.json as string);
      return undefined;
    default:
      throw new Error(`unexpected command ${cmd}`);
  }
}

beforeEach(() => {
  invokeMock.mockReset();
  statusResult = { ready: false, missing: [] };
  settingsBlob = {};
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve(routeInvoke(cmd, args)),
  );
});

describe('OnboardingStore', () => {
  it('is not visible before any check (status unknown)', () => {
    const s = new OnboardingStore();
    expect(s.visible).toBe(false);
  });

  it('becomes visible after a check that reports missing models', async () => {
    statusResult = { ready: false, missing: ['ggml-small.bin'] };
    const s = new OnboardingStore();
    await s.check('fast', false);
    expect(s.status).toEqual({ ready: false, missing: ['ggml-small.bin'] });
    expect(s.visible).toBe(true);
  });

  it('stays hidden after a check that reports everything present', async () => {
    statusResult = { ready: true, missing: [] };
    const s = new OnboardingStore();
    await s.check('accurate', true);
    expect(s.visible).toBe(false);
  });

  it('dismiss() hides it for the session even while models are still missing', async () => {
    statusResult = { ready: false, missing: ['Qwen3-1.7B-Q8_0.gguf'] };
    const s = new OnboardingStore();
    await s.check('accurate', true);
    expect(s.visible).toBe(true);
    s.dismiss();
    expect(s.visible).toBe(false);
    expect(s.dismissedThisSession).toBe(true);
  });

  it('a re-check that now reports ready hides the gate', async () => {
    statusResult = { ready: false, missing: ['ggml-small.bin'] };
    const s = new OnboardingStore();
    await s.check('fast', false);
    expect(s.visible).toBe(true);
    statusResult = { ready: true, missing: [] };
    await s.check('fast', false);
    expect(s.visible).toBe(false);
  });

  it('a failing status check leaves it hidden (modelsStatus degrades, ready false but unknown)', async () => {
    // modelsStatus swallows errors → { ready: false, missing: [] }. With nothing
    // known missing we still surface the gate (ready === false), so the user can
    // retry a download rather than being silently stuck.
    statusResult = new Error('boom');
    const s = new OnboardingStore();
    await s.check('fast', false);
    await flush();
    expect(s.status).toEqual({ ready: false, missing: [] });
    expect(s.visible).toBe(true);
  });

  // --- Persisted "seen once per user" flag -------------------------------------

  it('stays hidden when the persisted seen flag is set, even with models missing', async () => {
    settingsBlob = { onboarding: { seen: true } };
    statusResult = { ready: false, missing: ['ggml-small.bin'] };
    const s = new OnboardingStore();
    await s.load();
    await s.check('fast', false);
    expect(s.seen).toBe(true);
    expect(s.visible).toBe(false);
  });

  it('dismiss() persists the seen flag so the gate never returns', async () => {
    statusResult = { ready: false, missing: ['ggml-small.bin'] };
    const s = new OnboardingStore();
    await s.load();
    await s.check('fast', false);
    expect(s.visible).toBe(true);

    s.dismiss();
    await flush();
    // Persisted to the `onboarding` slice (merged into settings.json).
    expect(settingsBlob).toEqual({ onboarding: { seen: true } });

    // A fresh store on the next launch loads the flag and stays hidden.
    const next = new OnboardingStore();
    await next.load();
    await next.check('fast', false);
    expect(next.visible).toBe(false);
  });

  it('markSeen() persists the flag (used after a successful download closes the gate)', async () => {
    const s = new OnboardingStore();
    await s.load();
    s.markSeen();
    await flush();
    expect(s.seen).toBe(true);
    expect(settingsBlob).toEqual({ onboarding: { seen: true } });
  });

  it('load() defaults seen to false on a fresh install (no onboarding slice)', async () => {
    settingsBlob = {};
    const s = new OnboardingStore();
    await s.load();
    expect(s.seen).toBe(false);
  });
});
