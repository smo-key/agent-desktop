import { describe, expect, it } from 'vitest';
import { resolveFile } from './editor';

// Pure path-resolution for opening a transcript filename in the editor.

describe('resolveFile', () => {
  it('joins a relative file against the agent cwd', () => {
    expect(resolveFile('/home/u/proj', 'src/lib/auth.ts')).toBe('/home/u/proj/src/lib/auth.ts');
    // A trailing slash on cwd is normalized (no double slash).
    expect(resolveFile('/home/u/proj/', 'a.ts')).toBe('/home/u/proj/a.ts');
  });

  it('passes through an already-absolute path', () => {
    expect(resolveFile('/home/u/proj', '/etc/hosts')).toBe('/etc/hosts');
    expect(resolveFile('/home/u/proj', 'C:\\Users\\x\\a.ts')).toBe('C:\\Users\\x\\a.ts');
  });

  it('returns the token unchanged when there is no cwd', () => {
    expect(resolveFile(null, 'src/a.ts')).toBe('src/a.ts');
  });
});
