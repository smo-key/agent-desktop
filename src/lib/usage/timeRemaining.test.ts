import { describe, it, expect } from 'vitest';
import { timeRemainingShort } from './timeRemaining';

const NOW = 1_000_000;

describe('timeRemainingShort', () => {
  it('minutes under an hour', () => {
    expect(timeRemainingShort(NOW + 12 * 60, NOW)).toBe('12M');
    expect(timeRemainingShort(NOW + 59 * 60, NOW)).toBe('59M');
  });

  it('floors to at least 1M when seconds remain', () => {
    expect(timeRemainingShort(NOW + 30, NOW)).toBe('1M');
  });

  it('hours under a day', () => {
    expect(timeRemainingShort(NOW + 5 * 3600, NOW)).toBe('5H');
    expect(timeRemainingShort(NOW + 23 * 3600, NOW)).toBe('23H');
  });

  it('days at or beyond 24h', () => {
    expect(timeRemainingShort(NOW + 6 * 86400, NOW)).toBe('6D');
    expect(timeRemainingShort(NOW + 86400, NOW)).toBe('1D');
  });

  it('— for null, non-finite, or already elapsed', () => {
    expect(timeRemainingShort(null, NOW)).toBe('—');
    expect(timeRemainingShort(Number.NaN, NOW)).toBe('—');
    expect(timeRemainingShort(NOW - 10, NOW)).toBe('—');
    expect(timeRemainingShort(NOW, NOW)).toBe('—');
  });
});
