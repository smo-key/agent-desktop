import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the `voice://activate` handler so the wiring itself can be exercised —
// `activationAction` being correct proves nothing if a `case` dispatches to the
// wrong store method.
let handler: (() => void) | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, cb: () => void) => {
    handler = cb;
    return Promise.resolve(() => {});
  }
}));
vi.mock('$lib/voice/pipeline', () => ({ getActivePipeline: () => null }));

import { activationAction, initVoiceActivation } from './activation';
import { voiceStore } from './voiceStore.svelte';
import { voice } from '$lib/settings/voice.svelte';

// Unit tests for the PURE right-⌘ tap decision. The Tauri `listen` wiring stays
// in the thin wrapper (`initVoiceActivation`); only the branching lives here, so
// the gesture's behaviour in every panel phase is exercised headlessly.

describe('activationAction', () => {
  it('does nothing while voice input is disabled', () => {
    expect(activationAction(false, false, 'idle')).toBe('ignore');
    expect(activationAction(false, true, 'recording')).toBe('ignore');
    expect(activationAction(false, true, 'error')).toBe('ignore');
  });

  it('opens the panel when it is closed', () => {
    expect(activationAction(true, false, 'idle')).toBe('open');
  });

  it('finalizes while recording', () => {
    expect(activationAction(true, true, 'recording')).toBe('finalize');
  });

  it('finalize is a no-op mid-request or mid-transcribe (the pipeline guards it)', () => {
    expect(activationAction(true, true, 'requesting')).toBe('finalize');
    expect(activationAction(true, true, 'transcribing')).toBe('finalize');
  });

  // Spec: voice-dictation — "Activation tap recovers from a failed dictation".
  // Previously this routed to stopAndInsert(), which bails on any non-recording
  // phase — leaving the gesture inert with the error stuck on screen.
  it('activation tap recovers from a failed dictation', () => {
    expect(activationAction(true, true, 'error')).toBe('retry');
    expect(activationAction(true, true, 'denied')).toBe('retry');
  });
});

describe('initVoiceActivation — the tap is wired to the right store method', () => {
  beforeEach(async () => {
    handler = null;
    voice.prefs.enabled = true;
    voiceStore.close();
    voiceStore.setFinal('');
    await initVoiceActivation();
  });

  it('a tap on the closed panel opens it', () => {
    handler?.();
    expect(voiceStore.open).toBe(true);
    expect(voiceStore.state).toBe('idle');
  });

  it('a tap while errored retries in place rather than closing', () => {
    voiceStore.show();
    voiceStore.setState('recording');
    voiceStore.setError('Didn’t catch that — try again.');
    const before = voiceStore.session;

    handler?.();

    expect(voiceStore.open).toBe(true);
    expect(voiceStore.state).toBe('idle');
    expect(voiceStore.error).toBeNull();
    expect(voiceStore.session).toBe(before + 1);
  });

  it('a tap while denied retries too', () => {
    voiceStore.show();
    voiceStore.setError('Microphone access is blocked.', 'denied');
    handler?.();
    expect(voiceStore.state).toBe('idle');
    expect(voiceStore.error).toBeNull();
  });

  it('a tap does nothing while voice input is disabled', () => {
    voice.prefs.enabled = false;
    handler?.();
    expect(voiceStore.open).toBe(false);
    voice.prefs.enabled = true;
  });
});
