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
      '/a': {
        branch: 'main',
        dirty: true,
        modified: 4,
        ahead: 2,
        behind: 0,
        upstream: true,
        files: ['a.ts', 'b.ts']
      },
      '/b': { branch: null, dirty: null, modified: null, ahead: null, behind: null }
    });
    expect(out['/a']).toEqual({
      branch: 'main',
      dirty: true,
      modified: 4,
      ahead: 2,
      behind: 0,
      upstream: true,
      files: ['a.ts', 'b.ts']
    });
    // A missing `files`/`upstream` field normalizes to [] / null respectively.
    expect(out['/b']).toEqual({
      branch: null,
      dirty: null,
      modified: null,
      ahead: null,
      behind: null,
      upstream: null,
      files: []
    });
  });

  it('carries upstream=false for an unpushed branch', () => {
    const out = normalizeGitMap({
      '/a': { branch: 'feat', dirty: false, modified: 0, ahead: 3, behind: 0, upstream: false, files: [] }
    });
    expect(out['/a'].upstream).toBe(false);
    expect(out['/a'].ahead).toBe(3);
  });

  it('drops malformed numbers/strings to null and skips non-object entries', () => {
    const out = normalizeGitMap({
      '/a': {
        branch: 123,
        dirty: 'yes',
        modified: 'lots',
        ahead: Number.NaN,
        behind: 'x',
        upstream: 'maybe',
        files: 'nope'
      },
      '/b': 'not-an-object'
    });
    expect(out['/a']).toEqual({
      branch: null,
      dirty: null,
      modified: null,
      ahead: null,
      behind: null,
      upstream: null,
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
