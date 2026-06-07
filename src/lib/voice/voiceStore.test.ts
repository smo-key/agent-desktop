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
});
