import { describe, expect, it } from 'vitest';
import { dominantColor } from './logo';

// Build an RGBA buffer of `count` pixels all the same color (helper for the
// pure dominant-color tests). Alpha defaults to opaque.
function fill(count: number, [r, g, b, a = 255]: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(r, g, b, a);
  return out;
}

function img(...pixels: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

describe('dominantColor', () => {
  it('picks a vibrant color over a gray background', () => {
    // 90 gray pixels (#808080, no saturation) + 10 red (#e02020).
    const data = img(fill(90, [128, 128, 128]), fill(10, [224, 32, 32]));
    expect(dominantColor(data, 10, 10)).toBe('#e02020');
  });

  it('skips fully transparent pixels', () => {
    // Lots of transparent red, a few opaque green -> green wins.
    const data = img(fill(50, [224, 32, 32, 0]), fill(8, [32, 200, 96]));
    expect(dominantColor(data, 1, 58)).toBe('#20c860');
  });

  it('falls back to neutral grey for an all-gray image', () => {
    const data = img(fill(64, [128, 128, 128]));
    expect(dominantColor(data, 8, 8)).toBe('#7b8499');
  });

  it('falls back to neutral grey for a fully transparent image', () => {
    const data = img(fill(64, [224, 32, 32, 0]));
    expect(dominantColor(data, 8, 8)).toBe('#7b8499');
  });
});
