import { describe, it, expect } from 'vitest';
import { overallPercent, formatBytes, downloadRows, type PerModel } from './models';

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

describe('formatBytes', () => {
  it('formats GB-scale sizes with one decimal', () => {
    expect(formatBytes(1_834_426_016)).toBe('1.8 GB');
    expect(formatBytes(574_000_000)).toBe('574 MB');
    expect(formatBytes(487_600_000)).toBe('488 MB');
  });

  it('formats small sizes in MB and rounds', () => {
    expect(formatBytes(77_700_000)).toBe('78 MB');
  });

  it('handles zero / unknown as a dash', () => {
    expect(formatBytes(0)).toBe('—');
  });

  it('rolls up to GB rather than rendering "1000 MB" near the boundary', () => {
    expect(formatBytes(999_500_000)).toBe('1.0 GB');
    expect(formatBytes(1_000_000_000)).toBe('1.0 GB');
  });

  it('treats non-finite / negative sizes as unknown (dash, never "NaN MB")', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatBytes(-5)).toBe('—');
  });
});

describe('downloadRows', () => {
  it('maps known missing filenames to labelled rows with sizes and a total', () => {
    const { rows, totalBytes } = downloadRows([
      'ggml-large-v3-turbo-q5_0.bin',
      'Qwen3-1.7B-Q8_0.gguf'
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Accurate transcription', 'Transcript polish']);
    expect(rows.map((r) => r.size)).toEqual(['574 MB', '1.8 GB']);
    expect(totalBytes).toBe(574_000_000 + 1_834_426_016);
  });

  it('keeps an unknown filename as a row labelled by its filename with no size', () => {
    const { rows, totalBytes } = downloadRows(['mystery.bin']);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('mystery.bin');
    expect(rows[0].size).toBe('—');
    expect(totalBytes).toBe(0);
  });

  it('is empty for no missing models', () => {
    const { rows, totalBytes } = downloadRows([]);
    expect(rows).toEqual([]);
    expect(totalBytes).toBe(0);
  });
});
