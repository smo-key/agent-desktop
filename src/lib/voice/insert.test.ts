import { describe, expect, it } from 'vitest';
import {
  NO_TARGET_MESSAGE,
  insertDictation,
  insertVoiceText,
  resolveFocusedAgentHandle
} from './insert';
import type { TerminalHandle } from '../layout/terminals';
import { voiceStore } from './voiceStore.svelte';

// Tests for the voice INSERTION primitive (tasks.md 8.1 + 8.2; spec:
// "Verbatim insertion into the focused agent terminal"). The `it(...)` titles
// align with the spec `#### Scenario:` names ("Insert into focused terminal" /
// "No focused agent terminal"). Everything is exercised against a FAKE
// TerminalHandle so there is no Svelte/Tauri/xterm wiring — the assertion that
// the EXACT bytes reach the PTY with NO trailing `\r` is the load-bearing one.
//
// Insertion uses `sendKeys` (raw verbatim, no carriage return) — NOT `send`
// (which appends `\r` = auto-submit). The fake records exactly what each method
// receives so the test can prove which path was used and with what payload.

/**
 * A fake TerminalHandle that records every `sendKeys` and `send` it receives.
 * `sendKeys`/`send` report a boolean like the real handle: `true` for a live PTY
 * (default), `false` for a dead one — pass `{ alive: false }` to simulate an
 * exited process.
 */
function fakeHandle(opts: { alive?: boolean } = {}) {
  const alive = opts.alive ?? true;
  const sentKeys: string[] = [];
  const sent: string[] = [];
  const handle: TerminalHandle = {
    getSelection: () => '',
    hasSelection: () => false,
    paste: () => {},
    send: (text: string): boolean => {
      if (!alive) return false;
      sent.push(text);
      return true;
    },
    sendKeys: (data: string): boolean => {
      if (!alive) return false;
      sentKeys.push(data);
      return true;
    },
    focus: () => {},
    scrollToBottom: () => {}
  };
  return { handle, sentKeys, sent };
}

describe('insert — Verbatim insertion into the focused agent terminal', () => {
  it('Insert into focused terminal', () => {
    const { handle, sentKeys, sent } = fakeHandle();

    const result = insertVoiceText(handle, 'add a login button');

    expect(result).toEqual({ ok: true });
    // The EXACT text reaches the PTY with NO trailing carriage return, and via
    // `sendKeys` (raw) — NEVER `send` (which would append `\r` = auto-submit).
    expect(sentKeys).toEqual(['add a login button']);
    expect(sentKeys[0]).not.toContain('\r');
    expect(sent).toEqual([]);
  });

  it('inserts multi-line text verbatim, unchanged, with no trailing carriage return', () => {
    const { handle, sentKeys } = fakeHandle();
    const multi = 'first line\nsecond line\n- a\n- b';

    const result = insertVoiceText(handle, multi);

    expect(result).toEqual({ ok: true });
    // Byte-for-byte identical: no newline -> CR translation, no trailing CR, no
    // transformation of any kind.
    expect(sentKeys).toEqual([multi]);
    expect(sentKeys[0]).toBe(multi);
    expect(sentKeys[0].endsWith('\r')).toBe(false);
  });

  it('No focused agent terminal', () => {
    const result = insertVoiceText(undefined, 'this has nowhere to go');
    expect(result).toEqual({ ok: false, reason: 'no-target' });
  });

  it('reports dead-pane when the PTY has exited', () => {
    const { handle, sentKeys } = fakeHandle({ alive: false });

    const result = insertVoiceText(handle, 'are you there?');

    expect(result).toEqual({ ok: false, reason: 'dead-pane' });
    // sendKeys was attempted (and returned false), but nothing was recorded.
    expect(sentKeys).toEqual([]);
  });

  it('treats empty / whitespace-only text as a no-op success and never writes', () => {
    const { handle, sentKeys } = fakeHandle();

    // No-op success: there is a target, but nothing to insert — never write, and
    // never report a failure the panel would surface as an error.
    expect(insertVoiceText(handle, '')).toEqual({ ok: true });
    expect(insertVoiceText(handle, '   \n\t ')).toEqual({ ok: true });
    expect(sentKeys).toEqual([]);
  });
});

describe('insert — resolveFocusedAgentHandle', () => {
  it('returns undefined when there is no focused pane', () => {
    const lookup = (_id: string): TerminalHandle | undefined => undefined;
    expect(resolveFocusedAgentHandle(null, lookup)).toBeUndefined();
    // An empty paneId (the store default for "nothing focused") is also no-target.
    expect(resolveFocusedAgentHandle('', lookup)).toBeUndefined();
  });

  it('resolves the focused paneId to its handle via the injected lookup', () => {
    const { handle } = fakeHandle();
    const lookup = (id: string) => (id === 'pane-a' ? handle : undefined);

    expect(resolveFocusedAgentHandle('pane-a', lookup)).toBe(handle);
    // A focused pane with no registered terminal (never mounted / exited) -> none.
    expect(resolveFocusedAgentHandle('pane-x', lookup)).toBeUndefined();
  });
});

describe('insert — insertDictation (wired entry point)', () => {
  it('inserts verbatim into the focused agent terminal without auto-submit', () => {
    const { handle, sentKeys, sent } = fakeHandle();
    const lookup = (id: string) => (id === 'focused' ? handle : undefined);

    const result = insertDictation('hello world', lookup, () => 'focused');

    expect(result).toEqual({ ok: true });
    expect(sentKeys).toEqual(['hello world']);
    expect(sent).toEqual([]);
  });

  it('surfaces a clear no-target error state when no agent is focused', () => {
    const lookup = (_id: string): TerminalHandle | undefined => undefined;

    const result = insertDictation('nowhere to go', lookup, () => null);

    expect(result).toEqual({ ok: false, reason: 'no-target' });
    expect(voiceStore.state).toBe('error');
    expect(voiceStore.error).toBe(NO_TARGET_MESSAGE);
  });
});
