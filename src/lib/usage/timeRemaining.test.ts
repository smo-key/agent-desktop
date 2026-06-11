// Pin the timezone so the same-day/different-day boundary is deterministic across
// machines (the absolute-time STRINGS are asserted via a stub formatter, so locale
// never enters in).
process.env.TZ = 'UTC';

import { describe, it, expect } from 'vitest';
import { timeRemainingShort, resetClause, usageLimitTooltip, type ClockFormat } from './timeRemaining';

const NOW = 1_000_000;

/** A stub clock formatter: deterministic, locale-free stand-ins for the real Intl
 *  output so the composition/same-day logic is what's under test. */
const FMT: ClockFormat = {
  time: (d) => `T${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  date: (d) => `D${d.getUTCMonth() + 1}/${d.getUTCDate()}`
};

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

describe('resetClause', () => {
  it('a same-day reset shows just the time', () => {
    // NOW is 13:46:40 UTC; +2h is still the same UTC calendar day.
    expect(resetClause(NOW + 2 * 3600, NOW, FMT)).toBe('resets at T15:46');
  });

  it('a different-day reset shows the date and time', () => {
    // +2 days is unambiguously a different calendar day in any timezone.
    expect(resetClause(NOW + 2 * 86400, NOW, FMT)).toBe('resets D1/14 at T13:46');
  });

  it('null for an unknown (null/non-finite) reset time', () => {
    expect(resetClause(null, NOW, FMT)).toBeNull();
    expect(resetClause(Number.NaN, NOW, FMT)).toBeNull();
  });
});

// `it(...)` titles match the usage-dashboard spec `#### Scenario:` names so the
// scenario-coverage gate maps them.
describe('usageLimitTooltip', () => {
  it('Tooltip shows a same-day reset as a time', () => {
    // NOW is 13:46:40 UTC; +2h is still the same UTC calendar day → time only.
    expect(usageLimitTooltip('5-hour', 33, NOW + 2 * 3600, NOW, FMT)).toBe(
      '5-hour limit — 33% used · resets at T15:46'
    );
  });

  it('Tooltip shows a different-day reset as date and time', () => {
    // +2 days is unambiguously a different calendar day → date + time.
    expect(usageLimitTooltip('7-day', 21, NOW + 2 * 86400, NOW, FMT)).toBe(
      '7-day limit — 21% used · resets D1/14 at T13:46'
    );
  });

  it('Tooltip omits an unknown reset', () => {
    expect(usageLimitTooltip('5-hour', 33, null, NOW, FMT)).toBe('5-hour limit — 33% used');
  });

  it('shows a dash for an unknown used percent', () => {
    expect(usageLimitTooltip('5-hour', null, NOW + 2 * 3600, NOW, FMT)).toBe(
      '5-hour limit — — used · resets at T15:46'
    );
  });
});
