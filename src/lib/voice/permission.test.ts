import { describe, expect, it } from 'vitest';
import {
  classifyMicError,
  micGuidanceFor,
  MIC_DENIED_GUIDANCE,
  MIC_ERROR_GUIDANCE
} from './permission';

// PURE unit tests for the mic-permission mapping. The actual getUserMedia call
// (in capture.ts) is a thin browser wrapper exercised live (MANUAL); ALL the
// decision logic that turns a rejection into denied/error + guidance lives here.

/** Build a DOMException-shaped error by name (jsdom has DOMException). */
function errNamed(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('classifyMicError', () => {
  // Aligns with spec scenario "Permission denied".
  it('Permission denied: NotAllowedError maps to denied', () => {
    expect(classifyMicError(errNamed('NotAllowedError'))).toBe('denied');
  });

  it('SecurityError maps to denied', () => {
    expect(classifyMicError(errNamed('SecurityError'))).toBe('denied');
  });

  it('PermissionDeniedError maps to denied', () => {
    expect(classifyMicError(errNamed('PermissionDeniedError'))).toBe('denied');
  });

  it('NotFoundError maps to error', () => {
    expect(classifyMicError(errNamed('NotFoundError'))).toBe('error');
  });

  it('NotReadableError maps to error', () => {
    expect(classifyMicError(errNamed('NotReadableError'))).toBe('error');
  });

  it('undefined maps to error', () => {
    expect(classifyMicError(undefined)).toBe('error');
  });

  it('a plain object without a name maps to error', () => {
    expect(classifyMicError({})).toBe('error');
  });

  it('a plain object with a denied name still maps to denied', () => {
    expect(classifyMicError({ name: 'NotAllowedError' })).toBe('denied');
  });
});

describe('mic guidance strings', () => {
  it('denied guidance is non-empty and mentions System Settings', () => {
    expect(MIC_DENIED_GUIDANCE.length).toBeGreaterThan(0);
    expect(MIC_DENIED_GUIDANCE).toMatch(/System Settings/i);
  });

  it('error guidance is non-empty', () => {
    expect(MIC_ERROR_GUIDANCE.length).toBeGreaterThan(0);
  });

  it('micGuidanceFor returns the denied guidance for denied', () => {
    expect(micGuidanceFor('denied')).toBe(MIC_DENIED_GUIDANCE);
  });

  it('micGuidanceFor returns the generic guidance for error', () => {
    expect(micGuidanceFor('error')).toBe(MIC_ERROR_GUIDANCE);
  });
});
