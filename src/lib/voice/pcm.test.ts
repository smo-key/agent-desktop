import { describe, it, expect } from 'vitest';
import { concatFloat32, bucketBars } from './pcm';

describe('concatFloat32', () => {
  it('concatenates chunks in order into one contiguous buffer', () => {
    const a = new Float32Array([0.1, 0.2]);
    const b = new Float32Array([0.3]);
    const c = new Float32Array([0.4, 0.5, 0.6]);
    const out = concatFloat32([a, b, c]);
    expect(Array.from(out)).toEqual([
      0.1, 0.2, 0.3, 0.4, 0.5, 0.6
    ].map((n) => Math.fround(n)));
    expect(out.length).toBe(6);
  });

  it('returns an empty array for no chunks', () => {
    const out = concatFloat32([]);
    expect(out.length).toBe(0);
  });

  it('copies inputs so the result is independent of the source chunks', () => {
    const a = new Float32Array([1, 2]);
    const out = concatFloat32([a]);
    a[0] = 99;
    expect(out[0]).toBe(1); // unchanged — result owns its buffer
  });
});

describe('bucketBars', () => {
  it('returns `count` zeros for an empty spectrum', () => {
    expect(bucketBars([], 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('averages each bucket and normalizes to 0–1 (÷255)', () => {
    // 4 bins → 2 buckets: [255,255] → 1.0, [0,0] → 0.0
    expect(bucketBars([255, 255, 0, 0], 2)).toEqual([1, 0]);
  });

  it('a full-scale spectrum maps every bar to 1', () => {
    expect(bucketBars([255, 255, 255, 255, 255, 255, 255], 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('returns [] for a non-positive count', () => {
    expect(bucketBars([1, 2, 3], 0)).toEqual([]);
  });
});
