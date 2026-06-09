import { describe, expect, it, vi } from 'vitest';
import {
  encodeInitialInput,
  encodeInitialText,
  initialInputForMount,
  InitialInputSender,
  LaunchPromptReadiness,
  READY_MAX_MS,
  READY_QUIET_MS,
  SUBMIT_BYTES
} from './initialInput';

describe('initialInputForMount (one-shot prompt is never re-sent to a resumed pane)', () => {
  it('delivers the launch prompt on a FRESH spawn (resume falsey)', () => {
    expect(initialInputForMount('Commit all changes and push', false)).toBe(
      'Commit all changes and push'
    );
    expect(initialInputForMount('do x', undefined)).toBe('do x');
  });

  it('NEVER re-delivers the prompt to a RESUMED pane (archive→restore / preview)', () => {
    // The bug: an auto-archived agent task that the inbox auto-previews remounts with
    // resume:true and the registry's initialInput still set — it must not re-run.
    expect(initialInputForMount('Commit all changes and push', true)).toBeUndefined();
  });

  it('no prompt stays no prompt regardless of resume', () => {
    expect(initialInputForMount(undefined, false)).toBeUndefined();
    expect(initialInputForMount(null, true)).toBeUndefined();
    expect(initialInputForMount('', true)).toBeUndefined();
  });
});

/** A controllable stand-in for setTimeout/clearTimeout: tasks run only when the
 *  test advances the clock, so the quiet-window / hard-cap timing is exercised
 *  deterministically without real time. */
function fakeClock() {
  let now = 0;
  let seq = 1;
  type Handle = ReturnType<typeof setTimeout>;
  const tasks = new Map<number, { at: number; run: () => void }>();
  const schedule = (run: () => void, ms: number): Handle => {
    const id = seq++;
    tasks.set(id, { at: now + ms, run });
    return id as unknown as Handle;
  };
  const cancel = (h: Handle): void => {
    tasks.delete(h as unknown as number);
  };
  const advance = (ms: number): void => {
    now += ms;
    // Run every task whose deadline has passed, earliest first, re-checking after
    // each (a task may schedule another). Capped to avoid a runaway loop.
    for (let guard = 0; guard < 1000; guard += 1) {
      let next: [number, { at: number; run: () => void }] | null = null;
      for (const entry of tasks) {
        if (entry[1].at <= now && (next === null || entry[1].at < next[1].at)) next = entry;
      }
      if (next === null) return;
      tasks.delete(next[0]);
      next[1].run();
    }
  };
  return { schedule, cancel, advance, pending: () => tasks.size };
}

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

describe('LaunchPromptReadiness (deliver only once the TUI is ready)', () => {
  const gate = (onReady: () => void, clock: ReturnType<typeof fakeClock>) =>
    new LaunchPromptReadiness(onReady, clock.schedule, clock.cancel);

  // Scenario name from session-launcher spec (Requirement: Optional Initial
  // Prompt). The quiet/settle window starts only after the first output byte, so
  // delivery never writes into a not-yet-rendered TUI; a hard cap is the backstop.
  it('Initial prompt is delivered only after the TUI is ready', () => {
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);

    // Wired but silent past the quiet window: NOT delivered (TUI not rendering).
    g.wired();
    clock.advance(READY_QUIET_MS + 100);
    expect(onReady).not.toHaveBeenCalled();

    // First output, then settle: delivered exactly once.
    g.noteOutput();
    clock.advance(READY_QUIET_MS);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('does NOT deliver before claude emits its first output', () => {
    // REGRESSION: a slow startup (e.g. a coordinated agent loading the MCP
    // toolkit) can leave the PTY silent past the quiet window. Arming the quiet
    // timer at spawn would fire into a TUI that hasn't started rendering — the
    // prompt is lost and the session shows up blank / needs-input. The quiet
    // window must NOT start until the first output byte.
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);

    g.wired(); // PTY wired, but no output yet
    clock.advance(READY_QUIET_MS + 50); // well past the quiet window
    expect(onReady).not.toHaveBeenCalled();

    // Once the first byte arrives and output then settles, it delivers.
    g.noteOutput();
    clock.advance(READY_QUIET_MS);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('delivers once output has been quiet for READY_QUIET_MS after first byte', () => {
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);
    g.wired();
    g.noteOutput();
    clock.advance(READY_QUIET_MS - 1);
    expect(onReady).not.toHaveBeenCalled();
    clock.advance(1);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('resets the quiet window on every output byte', () => {
    // A burst of output keeps deferring delivery; it fires only after the LAST
    // byte has been quiet for the full window.
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);
    g.wired();
    for (let i = 0; i < 5; i += 1) {
      g.noteOutput();
      clock.advance(READY_QUIET_MS - 100); // never lets the window elapse
    }
    expect(onReady).not.toHaveBeenCalled();
    clock.advance(READY_QUIET_MS); // now output is quiet
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('delivers at the hard cap even if output never goes quiet', () => {
    // Continuous output (the quiet window never elapses) still delivers at the
    // hard cap measured from when the PTY was wired, so the prompt never hangs.
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);
    g.wired();
    // Emit a byte every (quiet - 50)ms so the quiet timer keeps resetting.
    for (let t = 0; t < READY_MAX_MS; t += READY_QUIET_MS - 50) {
      g.noteOutput();
      clock.advance(READY_QUIET_MS - 50);
    }
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('fires onReady at most once', () => {
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);
    g.wired();
    g.noteOutput();
    clock.advance(READY_QUIET_MS);
    expect(onReady).toHaveBeenCalledOnce();
    // Further output / time must not re-deliver.
    g.noteOutput();
    clock.advance(READY_MAX_MS);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('dispose cancels pending timers so a torn-down pane never delivers', () => {
    const clock = fakeClock();
    const onReady = vi.fn();
    const g = gate(onReady, clock);
    g.wired();
    g.noteOutput();
    g.dispose();
    expect(clock.pending()).toBe(0);
    clock.advance(READY_MAX_MS);
    expect(onReady).not.toHaveBeenCalled();
  });
});
