import { describe, it, expect } from 'vitest';
import { barColor, BAR_YELLOW_AT, BAR_RED_AT } from './barColor';

describe('barColor', () => {
  it('thresholds are 50 (yellow) and 80 (red)', () => {
    expect(BAR_YELLOW_AT).toBe(50);
    expect(BAR_RED_AT).toBe(80);
  });

  it('green below 50', () => {
    expect(barColor(0)).toBe('var(--nominal-500)');
    expect(barColor(49)).toBe('var(--nominal-500)');
  });

  it('yellow from 50 to 79', () => {
    expect(barColor(50)).toBe('var(--caution-500)');
    expect(barColor(79)).toBe('var(--caution-500)');
  });

  it('red from 80 up', () => {
    expect(barColor(80)).toBe('var(--abort-500)');
    expect(barColor(100)).toBe('var(--abort-500)');
  });

  it('neutral track for null / non-finite', () => {
    expect(barColor(null)).toBe('var(--space-600)');
    expect(barColor(NaN)).toBe('var(--space-600)');
    expect(barColor(Infinity)).toBe('var(--space-600)');
  });

  it('treats negative as green (below yellow)', () => {
    expect(barColor(-5)).toBe('var(--nominal-500)');
  });
});
