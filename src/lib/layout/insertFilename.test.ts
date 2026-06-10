import { describe, it, expect, vi } from 'vitest';
import { quotePath, insertFilenameInto } from './insertFilename';
import type { TerminalHandle } from './terminals';

/** A minimal mock handle: only `paste` is exercised by these tests. */
function mockHandle(): TerminalHandle {
  return {
    getSelection: vi.fn(() => ''),
    hasSelection: vi.fn(() => false),
    paste: vi.fn(),
    send: vi.fn(() => true),
    sendKeys: vi.fn(() => true),
    focus: vi.fn(),
    scrollToBottom: vi.fn()
  };
}

describe('quotePath', () => {
  it('wraps a plain path in double quotes', () => {
    expect(quotePath('/Users/me/notes.txt')).toBe('"/Users/me/notes.txt"');
  });

  it('escapes an embedded double quote as \\"', () => {
    expect(quotePath('/tmp/a"b.txt')).toBe('"/tmp/a\\"b.txt"');
  });

  it('appends no trailing space', () => {
    const result = quotePath('/Users/me/notes.txt');
    expect(result.endsWith(' ')).toBe(false);
  });
});

describe('insertFilenameInto', () => {
  it('pastes the quoted path when pick resolves a path', async () => {
    const handle = mockHandle();
    const pick = vi.fn<() => Promise<string | null>>(() =>
      Promise.resolve('/Users/me/notes.txt')
    );

    await insertFilenameInto(handle, pick);

    expect(handle.paste).toHaveBeenCalledOnce();
    expect(handle.paste).toHaveBeenCalledWith('"/Users/me/notes.txt"');
  });

  it('does nothing when pick resolves null', async () => {
    const handle = mockHandle();
    const pick = vi.fn<() => Promise<string | null>>(() => Promise.resolve(null));

    await insertFilenameInto(handle, pick);

    expect(handle.paste).not.toHaveBeenCalled();
  });

  it('does not throw when the handle is undefined', async () => {
    const pick = vi.fn<() => Promise<string | null>>(() =>
      Promise.resolve('/Users/me/notes.txt')
    );

    await expect(insertFilenameInto(undefined, pick)).resolves.toBeUndefined();
  });
});
