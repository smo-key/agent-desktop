// OKLCH color helpers (perceptually-uniform lightness/chroma/hue), vendored and
// trimmed from the Skipa color util. Used to ensure an AUTO-PULLED accent color
// (extracted from a project logo) is light enough to read on the dark UI:
// `clampLightness` raises a too-dark color's OKLCH lightness to a floor while
// reducing chroma as needed to stay inside the sRGB gamut (so the hue holds).
//
// Pure + framework-free (no DOM), so it is trivially unit-tested.

/** The minimum OKLCH lightness (0..1) a pulled accent color is raised to, so it
 *  reads clearly as a glyph/tint on the app's near-black surfaces. */
export const MIN_ACCENT_LIGHTNESS = 0.65;

/** `{r,g,b}` (0..255) for a `#rgb` / `#rrggbb` hex (with or without `#`). Throws on
 *  an invalid string. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

/** `#rrggbb` (lowercase) for 0..255 channels (rounded + clamped). */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function toLinear(c: number): number {
  const n = c / 255;
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
}

function fromLinear(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** RGB (0..255) -> OKLCH `{l: 0..1, c: 0+, h: 0..360}`. */
export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

/** OKLCH -> RGB (0..255, rounded + clamped). */
export function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lr = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;

  return {
    r: Math.round(fromLinear(4.0767416621 * lr - 3.3077115913 * mc + 0.2309699292 * sc) * 255),
    g: Math.round(fromLinear(-1.2684380046 * lr + 2.6097574011 * mc - 0.3413193965 * sc) * 255),
    b: Math.round(fromLinear(-0.0041960863 * lr - 0.7034186147 * mc + 1.707614701 * sc) * 255)
  };
}

/** Whether an OKLCH color sits inside the sRGB gamut (channels land in 0..255 with
 *  no clamping needed). */
function inGamut(l: number, c: number, h: number): boolean {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const lr = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;
  const R = fromLinear(4.0767416621 * lr - 3.3077115913 * mc + 0.2309699292 * sc);
  const G = fromLinear(-1.2684380046 * lr + 2.6097574011 * mc - 0.3413193965 * sc);
  const B = fromLinear(-0.0041960863 * lr - 0.7034186147 * mc + 1.707614701 * sc);
  const eps = 0.0005;
  return R >= -eps && R <= 1 + eps && G >= -eps && G <= 1 + eps && B >= -eps && B <= 1 + eps;
}

/** The largest chroma (<= `maxC`) that keeps `(l, h)` in the sRGB gamut. Binary
 *  search — raising lightness can push a saturated color out of gamut, so we pull
 *  chroma in rather than letting the channel clamp distort the hue. */
function maxChroma(l: number, h: number, maxC: number): number {
  if (inGamut(l, maxC, h)) return maxC;
  let lo = 0;
  let hi = maxC;
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2;
    if (inGamut(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Return `hex` with its OKLCH lightness raised to at least `minL` (default
 * `MIN_ACCENT_LIGHTNESS`). A color already at/above the floor is returned verbatim.
 * When lightening, chroma is reduced to the in-gamut maximum so the hue is
 * preserved. An invalid hex is returned unchanged (defensive — never throws).
 */
export function clampLightness(hex: string, minL: number = MIN_ACCENT_LIGHTNESS): string {
  let rgb: { r: number; g: number; b: number };
  try {
    rgb = hexToRgb(hex);
  } catch {
    return hex;
  }
  const { l, c, h } = rgbToOklch(rgb.r, rgb.g, rgb.b);
  if (l >= minL) return hex;
  const c2 = maxChroma(minL, h, c);
  const out = oklchToRgb(minL, c2, h);
  return rgbToHex(out.r, out.g, out.b);
}
