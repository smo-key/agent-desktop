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
      '/a': { branch: 'main', dirty: true, modified: 4, ahead: 2, behind: 0, files: ['a.ts', 'b.ts'] },
      '/b': { branch: null, dirty: null, modified: null, ahead: null, behind: null }
    });
    expect(out['/a']).toEqual({
      branch: 'main',
      dirty: true,
      modified: 4,
      ahead: 2,
      behind: 0,
      files: ['a.ts', 'b.ts']
    });
    // A missing `files` field normalizes to an empty array (no list).
    expect(out['/b']).toEqual({
      branch: null,
      dirty: null,
      modified: null,
      ahead: null,
      behind: null,
      files: []
    });
  });

  it('drops malformed numbers/strings to null and skips non-object entries', () => {
    const out = normalizeGitMap({
      '/a': { branch: 123, dirty: 'yes', modified: 'lots', ahead: Number.NaN, behind: 'x', files: 'nope' },
      '/b': 'not-an-object'
    });
    expect(out['/a']).toEqual({
      branch: null,
      dirty: null,
      modified: null,
      ahead: null,
      behind: null,
      files: []
    });
    expect('/b' in out).toBe(false);
  });

  it('keeps only string entries in files (drops non-strings)', () => {
    const out = normalizeGitMap({
      '/a': { branch: 'm', dirty: true, modified: 2, ahead: 0, behind: 0, files: ['ok.ts', 7, null, 'two.ts'] }
    });
    expect(out['/a'].files).toEqual(['ok.ts', 'two.ts']);
  });
});
