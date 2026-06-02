import { describe, expect, it, vi } from 'vitest';
import { encodeInitialInput, InitialInputSender } from './initialInput';

// Tests for the PURE initial-input delivery helper used by TerminalPane to write
// an OPTIONAL user-supplied initial prompt to the PTY exactly ONCE after spawn.
// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// session-launcher spec (Requirements: Optional Initial Prompt, No Auto-Run Of
// Slash Commands). The native dialog + live PTY wiring are MANUAL; this proves
// the load-bearing properties: sent-once, verbatim, no app-synthesized command.

describe('encodeInitialInput', () => {
  it('Launch with an initial prompt', () => {
    // A non-empty prompt is delivered VERBATIM, terminated by a single carriage
    // return (\r) so `claude` submits it as the opening user message.
    expect(encodeInitialInput('hello world')).toEqual(
      Array.from(new TextEncoder().encode('hello world\r'))
    );
    // The text is byte-for-byte the user's, with exactly one trailing \r and no
    // injected newline or extra characters.
    const bytes = encodeInitialInput('fix the bug');
    expect(new TextDecoder().decode(new Uint8Array(bytes!))).toBe('fix the bug\r');
  });

  it('Launch with no initial prompt', () => {
    // No prompt (undefined / empty / whitespace-only) => nothing is written, so
    // claude starts at an idle interactive prompt with no synthetic input.
    expect(encodeInitialInput(undefined)).toBeNull();
    expect(encodeInitialInput('')).toBeNull();
    expect(encodeInitialInput('   ')).toBeNull();
  });

  it('No slash command is injected on launch', () => {
    // The helper NEVER synthesizes a slash command. With no user prompt there is
    // nothing to send; the only input ever produced is the user's verbatim text.
    expect(encodeInitialInput(undefined)).toBeNull();
    // It does not prepend, append, or fabricate any `/workflow:*` (or other)
    // command — a plain prompt encodes to exactly itself + \r, nothing more.
    const bytes = encodeInitialInput('do the thing')!;
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    expect(text).toBe('do the thing\r');
    expect(text).not.toContain('/');
  });

  it('Initial prompt beginning with a slash is passed through verbatim', () => {
    // A user prompt that itself starts with `/` is delivered byte-for-byte,
    // WITHOUT expanding, intercepting, or executing it as an app-driven command.
    const bytes = encodeInitialInput('/release the build')!;
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe(
      '/release the build\r'
    );
  });
});

describe('InitialInputSender (sent-once guard)', () => {
  it('writes the initial input to the PTY exactly once', () => {
    // The sender writes ONCE and is idempotent across re-renders: a second (or
    // third) trigger after a successful send is a no-op, so a prompt is never
    // double-submitted when the component re-renders.
    const write = vi.fn();
    const sender = new InitialInputSender('ship it');

    expect(sender.trySend(write)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      Array.from(new TextEncoder().encode('ship it\r'))
    );

    // Re-render / re-trigger: no second write.
    expect(sender.trySend(write)).toBe(false);
    expect(sender.trySend(write)).toBe(false);
    expect(write).toHaveBeenCalledOnce();
  });

  it('never writes when there is no initial input', () => {
    // With no prompt the sender writes nothing AND still latches as "done", so an
    // empty-prompt launch can never accidentally send on a later re-render.
    const write = vi.fn();
    const sender = new InitialInputSender(undefined);
    expect(sender.trySend(write)).toBe(false);
    expect(sender.trySend(write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
