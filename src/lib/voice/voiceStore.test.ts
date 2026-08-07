import { describe, expect, it } from 'vitest';
import { VoiceStore } from './voiceStore.svelte';

// Unit tests for the voice runes store — the pure UI-state backbone the voice
// panel renders and later capture/transcription slices drive. No DOM needed:
// every transition is a small method on the store.

describe('VoiceStore', () => {
  it('starts idle and closed', () => {
    const s = new VoiceStore();
    expect(s.open).toBe(false);
    expect(s.state).toBe('idle');
    expect(s.partial).toBe('');
    expect(s.finalText).toBe('');
    expect(s.error).toBeNull();
  });

  it('show() opens and resets transient state', () => {
    const s = new VoiceStore();
    s.setPartial('half a sentence');
    s.setFinal('committed');
    s.setError('boom');
    s.show();
    expect(s.open).toBe(true);
    expect(s.state).toBe('idle');
    expect(s.partial).toBe('');
    expect(s.finalText).toBe('');
    expect(s.error).toBeNull();
  });

  it('show() while already open is a no-op (does not wipe an in-progress partial)', () => {
    const s = new VoiceStore();
    s.show();
    s.setState('recording');
    s.setPartial('listening to me');
    s.show(); // second call: single instance, must not reset
    expect(s.open).toBe(true);
    expect(s.state).toBe('recording');
    expect(s.partial).toBe('listening to me');
  });

  it('close() resets to idle and clears partial', () => {
    const s = new VoiceStore();
    s.show();
    s.setState('recording');
    s.setPartial('mid word');
    s.setFinal('final so far');
    s.close();
    expect(s.open).toBe(false);
    expect(s.state).toBe('idle');
    expect(s.partial).toBe('');
  });

  it('setPartial / setFinal / setState mutate as expected', () => {
    const s = new VoiceStore();
    s.setPartial('p');
    expect(s.partial).toBe('p');
    s.setFinal('f');
    expect(s.finalText).toBe('f');
    s.setState('transcribing');
    expect(s.state).toBe('transcribing');
  });

  it('setError sets the message and forces state to error', () => {
    const s = new VoiceStore();
    s.setState('recording');
    s.setError('mic unavailable');
    expect(s.error).toBe('mic unavailable');
    expect(s.state).toBe('error');
  });

  // Spec: voice-dictation — "Permission denied guidance survives the error message".
  // setError used to hard-force 'error', clobbering a 'denied' phase set moments
  // earlier — which hid the System Settings hint that only renders while denied.
  it('permission denied guidance survives the error message', () => {
    const s = new VoiceStore();
    s.show();
    s.setError('Microphone access is blocked.', 'denied');
    expect(s.state).toBe('denied');
    expect(s.error).toBe('Microphone access is blocked.');
  });

  // Spec: voice-dictation — "Retrying a failed dictation".
  it('retrying a failed dictation', () => {
    const s = new VoiceStore();
    s.show();
    s.setState('recording');
    s.setPartial('mumble');
    s.setFinal('mumble');
    const before = s.session;
    s.setError('Didn’t catch that — try again.');

    s.retry();

    expect(s.open).toBe(true); // stays open — retry is not a dismiss
    expect(s.state).toBe('idle');
    expect(s.error).toBeNull();
    expect(s.partial).toBe('');
    expect(s.finalText).toBe('');
    // The bumped session is what makes VoicePanel discard the spent pipeline and
    // build a fresh one (the old one is #finished and its mic is released).
    expect(s.session).toBe(before + 1);
  });

  it('retry() while closed is a no-op', () => {
    const s = new VoiceStore();
    const before = s.session;
    s.retry();
    expect(s.open).toBe(false);
    expect(s.session).toBe(before);
  });

  it('retry() recovers from the denied phase too', () => {
    const s = new VoiceStore();
    s.show();
    s.setError('Microphone access is blocked.', 'denied');
    s.retry();
    expect(s.state).toBe('idle');
    expect(s.error).toBeNull();
  });
});
