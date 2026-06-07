import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToOklch,
  oklchToRgb,
  clampLightness,
  MIN_ACCENT_LIGHTNESS
} from './oklch';

/** Measured OKLCH lightness (0..1) of a hex color. */
function lightnessOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return rgbToOklch(r, g, b).l;
}

describe('oklch conversions', () => {
  it('parses hex (3- and 6-digit, with/without #)', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('rgbToHex pads + lowercases', () => {
    expect(rgbToHex(255, 0, 16)).toBe('#ff0010');
  });

  it('round-trips rgb -> oklch -> rgb within a small tolerance', () => {
    for (const hex of ['#4c8dff', '#3ccb7f', '#e02020', '#11224a', '#808080']) {
      const { r, g, b } = hexToRgb(hex);
      const { l, c, h } = rgbToOklch(r, g, b);
      const back = oklchToRgb(l, c, h);
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(2);
    }
  });
});

describe('clampLightness', () => {
  it('raises a too-dark color to the minimum lightness', () => {
    // Dark navy — well below the floor.
    expect(lightnessOf('#11224a')).toBeLessThan(MIN_ACCENT_LIGHTNESS);
    const out = clampLightness('#11224a', MIN_ACCENT_LIGHTNESS);
    expect(lightnessOf(out)).toBeGreaterThanOrEqual(MIN_ACCENT_LIGHTNESS - 0.02);
    // Output is a valid 6-digit hex.
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('leaves an already-bright color unchanged', () => {
    // White is L=1, comfortably above the floor.
    expect(clampLightness('#ffffff', MIN_ACCENT_LIGHTNESS)).toBe('#ffffff');
  });

  it('preserves hue family when lightening (a dark blue stays blue-ish)', () => {
    const { h: beforeH } = rgbToOklch(...Object.values(hexToRgb('#11224a')) as [number, number, number]);
    const out = clampLightness('#11224a', MIN_ACCENT_LIGHTNESS);
    const { h: afterH } = rgbToOklch(...Object.values(hexToRgb(out)) as [number, number, number]);
    // Hue within ~12° (chroma reduction can nudge it slightly).
    expect(Math.abs(((afterH - beforeH + 540) % 360) - 180)).toBeLessThan(12);
  });

  it('returns the input unchanged on an invalid hex (defensive)', () => {
    expect(clampLightness('not-a-color', MIN_ACCENT_LIGHTNESS)).toBe('not-a-color');
  });
});
