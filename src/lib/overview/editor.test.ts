import { beforeEach, describe, expect, it, vi } from 'vitest';

// `openWith` is mocked so `openInEditor`'s wiring (resolve the file AND forward the
// cwd as the workspace) can be asserted without the open-with store/Tauri.
const openFileMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
vi.mock('$lib/settings/openWith.svelte', () => ({
  openWith: { openFile: (...a: unknown[]) => openFileMock(...a) }
}));

import { openInEditor, resolveFile } from './editor';

beforeEach(() => {
  openFileMock.mockReset();
  openFileMock.mockResolvedValue(undefined);
});

// Pure path-resolution for opening a transcript filename in the editor.

describe('openInEditor', () => {
  it('resolves the file against cwd AND forwards cwd as the workspace', async () => {
    await openInEditor('/home/u/proj', 'src/a.ts');
    expect(openFileMock).toHaveBeenCalledWith('/home/u/proj/src/a.ts', '/home/u/proj');
  });

  it('passes a null workspace through when there is no cwd', async () => {
    await openInEditor(null, '/abs/a.ts');
    expect(openFileMock).toHaveBeenCalledWith('/abs/a.ts', null);
  });
});

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
