import { describe, it, expect } from 'vitest';
import { friendlyTime } from './friendlyTime';

// `now` fixed at 2026-06-06T12:00:00Z for deterministic relative + absolute output.
const NOW = Date.UTC(2026, 5, 6, 12, 0, 0);
const ago = (ms: number) => Math.floor((NOW - ms) / 1000);

describe('friendlyTime', () => {
  it('null / non-finite / future -> em dash', () => {
    expect(friendlyTime(null, NOW)).toBe('—');
    expect(friendlyTime(Number.NaN, NOW)).toBe('—');
    expect(friendlyTime(Math.floor(NOW / 1000) + 600, NOW)).toBe('—');
  });

  it('within ~45s reads "just now"', () => {
    expect(friendlyTime(ago(5_000), NOW)).toBe('just now');
    expect(friendlyTime(ago(44_000), NOW)).toBe('just now');
  });

  it('minutes', () => {
    expect(friendlyTime(ago(3 * 60_000), NOW)).toBe('3m ago');
    expect(friendlyTime(ago(59 * 60_000), NOW)).toBe('59m ago');
  });

  it('hours', () => {
    expect(friendlyTime(ago(2 * 3_600_000), NOW)).toBe('2h ago');
    expect(friendlyTime(ago(23 * 3_600_000), NOW)).toBe('23h ago');
  });

  it('yesterday then days', () => {
    expect(friendlyTime(ago(26 * 3_600_000), NOW)).toBe('yesterday');
    expect(friendlyTime(ago(3 * 86_400_000), NOW)).toBe('3d ago');
    expect(friendlyTime(ago(6 * 86_400_000), NOW)).toBe('6d ago');
  });

  it('older than a week falls back to an absolute "Mon D" date', () => {
    // 30 days before 2026-06-06 is 2026-05-07.
    expect(friendlyTime(ago(30 * 86_400_000), NOW)).toBe('May 7');
  });
});
