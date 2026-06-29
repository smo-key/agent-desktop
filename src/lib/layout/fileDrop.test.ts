import { describe, it, expect, vi } from 'vitest';
import {
  isImagePath,
  partitionDropPaths,
  physicalToCss,
  buildPathInsert,
  handleDropPaths,
  type DropDeps
} from './fileDrop';
import type { TerminalHandle } from './terminals';

describe('isImagePath', () => {
  it('treats common image extensions (any case) as images', () => {
    for (const p of [
      '/a/b.png',
      '/a/b.JPG',
      '/a/photo.jpeg',
      '/a/c.gif',
      '/x.webp',
      '/x.bmp',
      '/x.svg',
      '/deep.dir.name/shot.PNG'
    ]) {
      expect(isImagePath(p)).toBe(true);
    }
  });

  it('treats non-image / extension-less paths as non-images', () => {
    for (const p of ['/a/b.txt', '/a/b.pdf', '/a/README', '/a/archive.tar.gz', '/a/trailingdot.']) {
      expect(isImagePath(p)).toBe(false);
    }
  });
});

describe('partitionDropPaths', () => {
  it('splits images from others, preserving order within each group', () => {
    const { images, others } = partitionDropPaths([
      '/1.png',
      '/2.txt',
      '/3.gif',
      '/4.md',
      '/5.jpeg'
    ]);
    expect(images).toEqual(['/1.png', '/3.gif', '/5.jpeg']);
    expect(others).toEqual(['/2.txt', '/4.md']);
  });

  it('handles all-images and all-others', () => {
    expect(partitionDropPaths(['/a.png', '/b.webp'])).toEqual({
      images: ['/a.png', '/b.webp'],
      others: []
    });
    expect(partitionDropPaths(['/a.c', '/b.rs'])).toEqual({
      images: [],
      others: ['/a.c', '/b.rs']
    });
  });
});

describe('physicalToCss', () => {
  it('divides by the device pixel ratio', () => {
    expect(physicalToCss({ x: 200, y: 100 }, 2)).toEqual({ x: 100, y: 50 });
  });

  it('falls back to identity for a non-positive ratio', () => {
    expect(physicalToCss({ x: 30, y: 40 }, 0)).toEqual({ x: 30, y: 40 });
    expect(physicalToCss({ x: 30, y: 40 }, -1)).toEqual({ x: 30, y: 40 });
  });
});

describe('buildPathInsert', () => {
  it('quotes each path and joins with single spaces, no trailing space', () => {
    expect(buildPathInsert(['/Users/me/a.txt', '/tmp/b.md'])).toBe(
      '"/Users/me/a.txt" "/tmp/b.md"'
    );
  });

  it('neutralizes shell metacharacters in each path', () => {
    expect(buildPathInsert(['/tmp/$(id).txt'])).toBe('"/tmp/\\$(id).txt"');
  });

  it('returns empty string for no paths', () => {
    expect(buildPathInsert([])).toBe('');
  });
});

/** A fake terminal handle that records paste/sendKeys calls. `alive` controls
 *  whether sendKeys reports a live PTY. */
function fakeHandle(alive = true) {
  const pastes: string[] = [];
  const keys: string[] = [];
  const handle: TerminalHandle = {
    getSelection: () => '',
    hasSelection: () => false,
    paste: (t) => void pastes.push(t),
    send: () => alive,
    sendKeys: (d) => {
      keys.push(d);
      return alive;
    },
    focus: () => {},
    scrollToBottom: () => {}
  };
  return { handle, pastes, keys };
}

function recordingDeps(overrides: Partial<DropDeps> = {}) {
  const copied: string[] = [];
  const delays: number[] = [];
  const deps: DropDeps = {
    copyImageToClipboard: async (p) => void copied.push(p),
    delay: async (ms) => void delays.push(ms),
    ...overrides
  };
  return { deps, copied, delays };
}

describe('handleDropPaths', () => {
  it('inserts non-image paths as one quoted string and pastes no images', async () => {
    const { handle, pastes, keys } = fakeHandle();
    const { deps, copied } = recordingDeps();
    await handleDropPaths(handle, ['/a.txt', '/b.md'], deps);
    expect(pastes).toEqual(['"/a.txt" "/b.md"']);
    expect(copied).toEqual([]);
    expect(keys).toEqual([]);
  });

  it('pastes each image via clipboard + Ctrl+V in order', async () => {
    const { handle, keys } = fakeHandle();
    const { deps, copied } = recordingDeps();
    await handleDropPaths(handle, ['/1.png', '/2.gif'], deps);
    expect(copied).toEqual(['/1.png', '/2.gif']);
    expect(keys).toEqual(['\x16', '\x16']);
  });

  it('handles a mixed drop: paths inserted, images pasted', async () => {
    const { handle, pastes, keys } = fakeHandle();
    const { deps, copied } = recordingDeps();
    await handleDropPaths(handle, ['/img.png', '/note.txt'], deps);
    expect(pastes).toEqual(['"/note.txt"']);
    expect(copied).toEqual(['/img.png']);
    expect(keys).toEqual(['\x16']);
  });

  it('stops pasting images once the PTY is dead', async () => {
    const { handle, keys } = fakeHandle(false);
    const { deps, copied } = recordingDeps();
    await handleDropPaths(handle, ['/1.png', '/2.png'], deps);
    // first image is copied + Ctrl+V attempted (returns false) → stop before #2
    expect(copied).toEqual(['/1.png']);
    expect(keys).toEqual(['\x16']);
  });

  it('skips an image whose clipboard write fails and continues', async () => {
    const { handle, keys } = fakeHandle();
    const copied: string[] = [];
    const { deps } = recordingDeps({
      copyImageToClipboard: async (p) => {
        copied.push(p);
        if (p === '/bad.png') throw new Error('boom');
      }
    });
    await handleDropPaths(handle, ['/bad.png', '/good.png'], deps);
    expect(copied).toEqual(['/bad.png', '/good.png']);
    // only the good one produced a Ctrl+V
    expect(keys).toEqual(['\x16']);
  });

  it('caps the number of images pasted from one drop', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handle, keys } = fakeHandle();
    const { deps, copied } = recordingDeps();
    const many = Array.from({ length: 20 }, (_, i) => `/img${i}.png`);
    await handleDropPaths(handle, many, deps);
    expect(copied).toHaveLength(16);
    expect(keys).toHaveLength(16);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
