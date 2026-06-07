import { describe, it, expect } from 'vitest';
import { normalizeGitMap } from './projectGit.svelte';

describe('normalizeGitMap', () => {
  it('non-object payloads -> empty map', () => {
    expect(normalizeGitMap(null)).toEqual({});
    expect(normalizeGitMap(undefined)).toEqual({});
    expect(normalizeGitMap(42)).toEqual({});
    expect(normalizeGitMap('x')).toEqual({});
  });

  it('coerces each entry to a stable GitStatus shape', () => {
    const out = normalizeGitMap({
      '/a': { branch: 'main', dirty: true, modified: 4, ahead: 2, behind: 0 },
      '/b': { branch: null, dirty: null, modified: null, ahead: null, behind: null }
    });
    expect(out['/a']).toEqual({ branch: 'main', dirty: true, modified: 4, ahead: 2, behind: 0 });
    expect(out['/b']).toEqual({ branch: null, dirty: null, modified: null, ahead: null, behind: null });
  });

  it('drops malformed numbers/strings to null and skips non-object entries', () => {
    const out = normalizeGitMap({
      '/a': { branch: 123, dirty: 'yes', modified: 'lots', ahead: Number.NaN, behind: 'x' },
      '/b': 'not-an-object'
    });
    expect(out['/a']).toEqual({ branch: null, dirty: null, modified: null, ahead: null, behind: null });
    expect('/b' in out).toBe(false);
  });
});
