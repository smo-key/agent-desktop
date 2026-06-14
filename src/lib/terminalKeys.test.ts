import { describe, expect, it } from 'vitest';
import { lineEditSeq, type KeyChord } from './terminalKeys';

// Tests for the pure ⌘←/⌘→ → line-edge byte mapping (terminal-core spec:
// Line-Edit Keys From The Host Keyboard). They pin the exact PTY bytes and the
// modifier gating, without touching xterm or a real KeyboardEvent. The first
// `it` title matches the spec's headless scenario verbatim (coverage gate); the
// live wiring (preventDefault + pty_write) is headless-exempt and confirmed in
// the app.

const chord = (over: Partial<KeyChord>): KeyChord => ({
  key: '',
  metaKey: false,
  altKey: false,
  ctrlKey: false,
  ...over
});

describe('lineEditSeq', () => {
  it('Cmd-Left and Cmd-Right map to the readline line-edge bytes', () => {
    expect(lineEditSeq(chord({ key: 'ArrowLeft', metaKey: true }))).toBe('\x01'); // Ctrl-A
    expect(lineEditSeq(chord({ key: 'ArrowRight', metaKey: true }))).toBe('\x05'); // Ctrl-E
  });

  it('requires Cmd and excludes Option/Control, so other chords fall through to xterm', () => {
    expect(lineEditSeq(chord({ key: 'ArrowLeft' }))).toBeNull(); // bare arrow
    expect(lineEditSeq(chord({ key: 'ArrowRight' }))).toBeNull();
    expect(lineEditSeq(chord({ key: 'ArrowLeft', metaKey: true, altKey: true }))).toBeNull(); // ⌥← word-wise
    expect(lineEditSeq(chord({ key: 'ArrowLeft', metaKey: true, ctrlKey: true }))).toBeNull(); // ⌃←
    expect(lineEditSeq(chord({ key: 'ArrowUp', metaKey: true }))).toBeNull();
    expect(lineEditSeq(chord({ key: 'ArrowDown', metaKey: true }))).toBeNull();
    expect(lineEditSeq(chord({ key: 'a', metaKey: true }))).toBeNull();
  });
});
