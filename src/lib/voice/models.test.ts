import { describe, it, expect } from 'vitest';
import { overallPercent, type PerModel } from './models';

describe('overallPercent', () => {
  it('returns 0 for an empty map (nothing to show yet)', () => {
    expect(overallPercent({})).toBe(0);
  });

  it('returns 0 when total is zero (unknown sizes)', () => {
    expect(overallPercent({ a: { received: 0, total: 0 } })).toBe(0);
  });

  it('aggregates received over total across multiple models', () => {
    const p: PerModel = {
      small: { received: 50, total: 100 },
      polish: { received: 50, total: 100 }
    };
    // 100 received / 200 total = 50%.
    expect(overallPercent(p)).toBe(50);
  });

  it('weights by size, not by model count', () => {
    const p: PerModel = {
      small: { received: 0, total: 100 },
      polish: { received: 900, total: 900 }
    };
    // 900 / 1000 = 90%.
    expect(overallPercent(p)).toBe(90);
  });

  it('floors fractional percents', () => {
    expect(overallPercent({ a: { received: 1, total: 3 } })).toBe(33);
  });

  it('clamps a model received beyond its total and never exceeds 100', () => {
    const p: PerModel = { a: { received: 200, total: 100 } };
    expect(overallPercent(p)).toBe(100);
  });

  it('reports 100 only when every model is fully received', () => {
    const p: PerModel = {
      a: { received: 100, total: 100 },
      b: { received: 100, total: 100 }
    };
    expect(overallPercent(p)).toBe(100);
  });
});
