import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uncommittedCountTooltip } from './uncommittedTooltip';

describe('uncommittedCountTooltip', () => {
  // Scenario: singular form for exactly 1 file
  it('returns singular form for 1 file', () => {
    expect(uncommittedCountTooltip(1)).toBe('1 uncommitted file');
  });

  // Scenario: plural form for multiple files
  it('returns plural form for 3 files', () => {
    expect(uncommittedCountTooltip(3)).toBe('3 uncommitted files');
  });

  // Scenario: sensible result for 0
  it('returns plural form for 0 files', () => {
    expect(uncommittedCountTooltip(0)).toBe('0 uncommitted files');
  });

  // Scenario: plural form for large counts
  it('returns plural form for many files', () => {
    expect(uncommittedCountTooltip(42)).toBe('42 uncommitted files');
  });
});
