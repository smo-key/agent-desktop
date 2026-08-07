import { describe, expect, it } from 'vitest';
import { activationAction } from './activation';

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
