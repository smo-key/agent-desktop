import { describe, expect, it, vi } from 'vitest';
import {
  encodeInitialInput,
  encodeInitialText,
  InitialInputSender,
  SUBMIT_BYTES
} from './initialInput';

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

describe('encodeInitialText (text only, no submit)', () => {
  it('encodes the prompt text VERBATIM with NO trailing carriage return', () => {
    // The text half carries ONLY the user's bytes — the submitting \r is a
    // SEPARATE write, so a still-initializing TUI can never swallow it as part of
    // the pasted line (the root cause of "typed but not sent").
    expect(encodeInitialText('fix the bug')).toEqual(
      Array.from(new TextEncoder().encode('fix the bug'))
    );
    const bytes = encodeInitialText('fix the bug')!;
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe('fix the bug');
    expect(bytes).not.toContain(0x0d);
  });

  it('yields null for no / blank prompt', () => {
    expect(encodeInitialText(undefined)).toBeNull();
    expect(encodeInitialText('')).toBeNull();
    expect(encodeInitialText('   ')).toBeNull();
  });

  it('SUBMIT_BYTES is exactly a single carriage return', () => {
    expect(SUBMIT_BYTES).toEqual([0x0d]);
  });
});

describe('InitialInputSender (two-phase, sent-once)', () => {
  it('delivers the text, then the Enter, as two separate writes', () => {
    // The verbatim text is written immediately; the submitting carriage return
    // is written only when the injected `schedule` fires (in the app, once
    // claude's TUI is up). The two writes are distinct payloads.
    const write = vi.fn();
    let submit: (() => void) | null = null;
    const sender = new InitialInputSender('ship it');

    expect(sender.deliver(write, (run) => (submit = run))).toBe(true);
    // First write: the text alone, no \r.
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      Array.from(new TextEncoder().encode('ship it'))
    );
    // The submit was scheduled, not yet sent.
    expect(submit).toBeTypeOf('function');

    // Once the scheduled submit fires, a lone carriage return is written.
    submit!();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith([0x0d]);
  });

  it('delivers exactly once and is idempotent across re-renders', () => {
    // A second (or third) deliver after the first is a no-op, so a prompt is
    // never double-submitted when the component re-renders.
    const write = vi.fn();
    const schedule = vi.fn();
    const sender = new InitialInputSender('ship it');

    expect(sender.deliver(write, schedule)).toBe(true);
    expect(sender.deliver(write, schedule)).toBe(false);
    expect(sender.deliver(write, schedule)).toBe(false);
    expect(write).toHaveBeenCalledOnce(); // only the one text write
    expect(schedule).toHaveBeenCalledOnce();
  });

  it('never writes (and never schedules) when there is no initial input', () => {
    // With no prompt the sender writes nothing AND still latches as "done", so an
    // empty-prompt launch can never accidentally send on a later re-render.
    const write = vi.fn();
    const schedule = vi.fn();
    const sender = new InitialInputSender(undefined);
    expect(sender.hasPrompt).toBe(false);
    expect(sender.deliver(write, schedule)).toBe(false);
    expect(sender.deliver(write, schedule)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});
