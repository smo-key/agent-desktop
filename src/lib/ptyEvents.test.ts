import { describe, expect, it } from 'vitest';
import { decodePtyBytes } from './ptyEvents';

describe('decodePtyBytes', () => {
  it('Output frames decode from base64 to the exact bytes', () => {
    // Matches the Rust `pty_event_json_shape_is_stable` fixture: [1, 2, 255].
    expect(Array.from(decodePtyBytes('AQL/'))).toEqual([1, 2, 255]);
  });

  it('round-trips every byte value, including a split UTF-8 sequence', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const b64 = btoa(String.fromCharCode(...all));
    expect(Array.from(decodePtyBytes(b64))).toEqual(Array.from(all));
    // First two bytes of a 3-byte codepoint: passed through verbatim (xterm reassembles).
    expect(Array.from(decodePtyBytes(btoa('\xe2\x94')))).toEqual([0xe2, 0x94]);
  });

  it('empty and malformed frames decode to no bytes', () => {
    expect(decodePtyBytes('').length).toBe(0);
    expect(decodePtyBytes('%%%not-base64%%%').length).toBe(0);
  });
});
