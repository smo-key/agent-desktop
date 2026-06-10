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

  it('escapes a backslash so an embedded \\" cannot break out of the quotes', () => {
    // Path literally containing the chars: / t m p / a \ " b
    // Both the backslash and the quote get a backslash, so the result is:
    //   "  /tmp/a  \\  \"  b  "   → a single literal token.
    expect(quotePath('/tmp/a\\"b')).toBe('"/tmp/a\\\\\\"b"');
  });

  it('escapes $ so a filename cannot trigger parameter/command expansion', () => {
    expect(quotePath('/tmp/$(id).txt')).toBe('"/tmp/\\$(id).txt"');
  });

  it('escapes a backtick', () => {
    expect(quotePath('/tmp/`x`.txt')).toBe('"/tmp/\\`x\\`.txt"');
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

  it('opens no dialog and does nothing when the handle is undefined', async () => {
    const pick = vi.fn<() => Promise<string | null>>(() =>
      Promise.resolve('/Users/me/notes.txt')
    );

    await expect(insertFilenameInto(undefined, pick)).resolves.toBeUndefined();
    // The target is checked BEFORE the picker — no live terminal → no dialog.
    expect(pick).not.toHaveBeenCalled();
  });
});
