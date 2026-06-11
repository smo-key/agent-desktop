import { describe, expect, it } from 'vitest';
import { modelLabel, effortLabel } from './modelLabel.js';

describe('modelLabel', () => {
  it('parses claude-opus-4-8 -> Opus 4.8', () => {
    expect(modelLabel('claude-opus-4-8', 'Opus')).toBe('Opus 4.8');
  });

  it('parses claude-sonnet-4-6 -> Sonnet 4.6', () => {
    expect(modelLabel('claude-sonnet-4-6', 'Claude Sonnet')).toBe('Sonnet 4.6');
  });

  it('parses claude-haiku-4-5-20251001 dropping date suffix -> Haiku 4.5', () => {
    expect(modelLabel('claude-haiku-4-5-20251001', 'Haiku')).toBe('Haiku 4.5');
  });

  it('parses claude-fable-5 with single version part -> Fable 5', () => {
    expect(modelLabel('claude-fable-5', 'Fable')).toBe('Fable 5');
  });

  it('falls back to displayName for unrecognized id', () => {
    expect(modelLabel('weird-unknown-id', 'Custom Model')).toBe('Custom Model');
  });

  it('returns displayName when id is null', () => {
    expect(modelLabel(null, 'Opus')).toBe('Opus');
  });

  it("returns '—' when both id and displayName are null", () => {
    expect(modelLabel(null, null)).toBe('—');
  });

  it("returns '—' when id is null and displayName is empty", () => {
    expect(modelLabel(null, '')).toBe('—');
  });

  it('handles three-part version claude-opus-4-8 correctly (not confused by date)', () => {
    expect(modelLabel('claude-opus-4-8', null)).toBe('Opus 4.8');
  });
});

describe('effortLabel', () => {
  it("low -> 'Low'", () => {
    expect(effortLabel('low')).toBe('Low');
  });

  it("xhigh -> 'XHigh'", () => {
    expect(effortLabel('xhigh')).toBe('XHigh');
  });

  it("max -> 'Max'", () => {
    expect(effortLabel('max')).toBe('Max');
  });

  it('null -> null', () => {
    expect(effortLabel(null)).toBeNull();
  });

  it("empty string -> null", () => {
    expect(effortLabel('')).toBeNull();
  });

  it("medium -> 'Medium'", () => {
    expect(effortLabel('medium')).toBe('Medium');
  });

  it("high -> 'High'", () => {
    expect(effortLabel('high')).toBe('High');
  });

  it('unknown non-empty -> capitalizes first letter', () => {
    expect(effortLabel('turbo')).toBe('Turbo');
  });
});
