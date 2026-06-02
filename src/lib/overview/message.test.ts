import { describe, expect, it } from 'vitest';
import { messageAgent } from './message';
import type { TerminalHandle } from '../layout/terminals';

// Tests for the thin message-an-agent dispatcher (Stage 1 of agent-overview).
// The `it(...)` titles are the EXACT `#### Scenario:` names from the agent-overview
// spec (Requirement: Message An Agent). The dispatcher is exercised against a FAKE
// registry (a lookup fn) so no Svelte/Tauri/xterm wiring is needed — the real PTY
// write path lives in TerminalPane's `send` handle (terminals.ts), confirmed live.

/**
 * A fake TerminalHandle that records every `send` it receives. `send` reports a
 * boolean exactly like the real handle: `true` for a live PTY (default), `false`
 * for a dead one — pass `{ alive: false }` to simulate an exited process.
 */
function fakeHandle(opts: { alive?: boolean } = {}) {
  const alive = opts.alive ?? true;
  const sent: string[] = [];
  const handle: TerminalHandle = {
    getSelection: () => '',
    hasSelection: () => false,
    paste: () => {},
    send: (text: string): boolean => {
      if (!alive) return false;
      sent.push(text);
      return true;
    }
  };
  return { handle, sent };
}

describe('message — Message An Agent', () => {
  it('Sending a message writes to the agent PTY', () => {
    const { handle, sent } = fakeHandle();
    const lookup = (id: string) => (id === 'pane-a' ? handle : undefined);

    const ok = messageAgent('pane-a', 'hello there', lookup);

    expect(ok).toBe(true);
    // The dispatcher hands the EXACT text to the handle's send (which is the path
    // that appends the single carriage return when it writes to the PTY).
    expect(sent).toEqual(['hello there']);

    // A DEAD pane (process exited -> send reports false) yields false, so the
    // caller never reports a false success against an agent that can't receive it.
    const dead = fakeHandle({ alive: false });
    const deadLookup = (id: string) => (id === 'pane-d' ? dead.handle : undefined);
    expect(messageAgent('pane-d', 'are you there?', deadLookup)).toBe(false);
    expect(dead.sent).toEqual([]);
  });

  // No handle for the pane (its session ended / never registered) => no-op, no throw.
  it('Messaging an unknown pane is a safe no-op', () => {
    const lookup = (_id: string) => undefined;
    expect(messageAgent('gone', 'hi', lookup)).toBe(false);
  });

  it('Only user-entered text is ever sent', () => {
    const { handle, sent } = fakeHandle();
    const lookup = (_id: string) => handle;

    // A slash-prefixed message is the USER's text — passed through VERBATIM, never
    // re-interpreted, expanded, or replaced by a synthesized command.
    messageAgent('p', '/clear', lookup);
    expect(sent).toEqual(['/clear']);

    // The dispatcher itself NEVER synthesizes input: an empty message sends
    // nothing (it does not invent a slash command or any other text on the user's
    // behalf), and returns false.
    sent.length = 0;
    expect(messageAgent('p', '', lookup)).toBe(false);
    expect(messageAgent('p', '   ', lookup)).toBe(false);
    expect(sent).toEqual([]);
  });
});
