// Project LOGO support: extract a project's accent color from a logo image, and
// turn a picked image file into a small PNG data URL + that color.
//
// `dominantColor` is PURE (operates on raw RGBA) and unit-tested. `processLogoFile`
// is the thin DOM/canvas wrapper (untested — exercised by running the app); it
// references `document`/`canvas` only when CALLED, so importing this module under
// the node test environment is safe.
//
// The pulled color is run through `clampLightness` (OKLCH) so a dark logo accent is
// raised to a readable lightness on the app's near-black surfaces — `dominantColor`
// itself stays a pure "what's the dominant accent" and the visibility floor is the
// composition step in `processLogoFile`.

import { clampLightness, MIN_ACCENT_LIGHTNESS } from './oklch';

/** The neutral grey used when an image has no usable accent (all gray/transparent). */
const NEUTRAL = '#7b8499';

/** `#rrggbb` (lowercase) for 0..255 channels. */
function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

/** HSL saturation + lightness (0..1) of an 0..255 RGB triple. */
function satLight(r: number, g: number, b: number): { s: number; l: number } {
  const rr = r / 255,
    gg = g / 255,
    bb = b / 255;
  const max = Math.max(rr, gg, bb),
    min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/**
 * The dominant ACCENT color of an RGBA image, as `#rrggbb`. Skips transparent
 * pixels and low-saturation grays / near-white / near-black (backgrounds and
 * outlines), buckets the rest by quantized RGB, and returns the most-populous
 * bucket's average color. Returns the neutral grey when nothing qualifies.
 *
 * Pure: depends only on its inputs. `data` is RGBA, length `width*height*4`.
 */
export function dominantColor(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number
): string {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const px = width * height;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    if (data[o + 3] < 125) continue; // transparent
    const r = data[o],
      g = data[o + 1],
      b = data[o + 2];
    const { s, l } = satLight(r, g, b);
    if (s < 0.15 || l < 0.1 || l > 0.95) continue; // gray / near-white / near-black
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); // 5 bits/channel
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best) return NEUTRAL;
  return toHex(best.r / best.n, best.g / best.n, best.b / best.n);
}

/**
 * Downscale a picked image `file` to a PNG data URL (longest side 64px, aspect
 * preserved) and extract its accent color. DOM/canvas — call only in the webview.
 */
export async function processLogoFile(file: File | Blob): Promise<{ dataUrl: string; color: string }> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 64 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('logo: no 2d canvas context');
    ctx.drawImage(bmp, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    // Pull the dominant accent, then lift it to a readable lightness (OKLCH) so a
    // dark logo color still shows up as the project's tint/glyph on the dark UI.
    const color = clampLightness(
      dominantColor(ctx.getImageData(0, 0, w, h).data, w, h),
      MIN_ACCENT_LIGHTNESS
    );
    return { dataUrl, color };
  } finally {
    bmp.close?.();
  }
}
