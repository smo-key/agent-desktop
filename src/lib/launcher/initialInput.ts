// PURE helper for delivering an OPTIONAL, user-supplied initial prompt to a
// freshly-spawned `claude` PTY (session-launcher spec, Requirements: Optional
// Initial Prompt + No Auto-Run Of Slash Commands). Kept framework-free (no
// Svelte/Tauri imports) so the load-bearing guarantees — sent VERBATIM, sent
// ONCE, and NEVER an app-synthesized command — are unit-tested without a DOM or
// a live PTY. `TerminalPane.svelte` constructs an `InitialInputSender` from its
// `initialInput` prop and calls `trySend(write)` once after the PTY is spawned
// and the input/output wiring is live.

/**
 * Encode an optional initial prompt into the exact PTY byte payload, or `null`
 * when there is nothing to send.
 *
 *  - A non-empty prompt encodes to the user's text VERBATIM followed by a single
 *    carriage return (`\r`), which is how a TUI submits the line. No newline,
 *    no extra characters, and — critically — no app-fabricated slash command is
 *    ever prepended or appended. A prompt that itself begins with `/` is passed
 *    through byte-for-byte (the app never expands or intercepts it).
 *  - `undefined`/`null`/empty/whitespace-only yields `null` (nothing to write),
 *    so a no-prompt launch leaves `claude` at an idle interactive prompt with no
 *    synthetic input injected.
 *
 * Returns a plain number[] (the shape `pty_write`'s `data` arg expects).
 */
export function encodeInitialInput(
  input: string | null | undefined
): number[] | null {
  if (typeof input !== 'string') return null;
  // Only a fully-blank prompt is treated as "no prompt". A prompt that is
  // non-empty after trimming is sent VERBATIM (the original, untrimmed text) so
  // the user's exact bytes reach the session.
  if (input.trim() === '') return null;
  return Array.from(new TextEncoder().encode(`${input}\r`));
}

/**
 * Verbatim bytes for the prompt TEXT alone — the user's text with NO trailing
 * carriage return — or `null` when there is no prompt (undefined/null/blank).
 * The submitting Enter is delivered as a SEPARATE write (see [`SUBMIT_BYTES`] and
 * [`InitialInputSender.deliver`]); keeping the text and the submit apart is what
 * fixes the "line typed but not sent" symptom on launch.
 */
export function encodeInitialText(input: string | null | undefined): number[] | null {
  if (typeof input !== 'string') return null;
  if (input.trim() === '') return null;
  return Array.from(new TextEncoder().encode(input));
}

/**
 * The one-shot launch prompt a pane should deliver ON MOUNT, gated on whether this
 * spawn is a RESUME. The initial prompt belongs to the FRESH launch only: a resumed
 * session (`claude --resume`) already contains it in its transcript, so it must
 * NEVER be re-sent. This matters because the prompt lives in the registry keyed by
 * paneId and a pane RE-MOUNTS on archive→restore / preview (`{#key paneId}` with
 * `closed` toggling) — each remount builds a fresh {@link InitialInputSender}. Without
 * this gate the sender would re-type + re-submit the launch prompt into the resumed
 * session, re-running it (e.g. an auto-archived "Commit and push" agent task that the
 * inbox auto-previews would commit+push again, looping). Returns the prompt only for a
 * fresh spawn (`resume` falsey); `undefined` for a resume.
 */
export function initialInputForMount(
  initialInput: string | null | undefined,
  resume: boolean | undefined
): string | undefined {
  return resume ? undefined : (initialInput ?? undefined);
}

/** The single byte a TUI reads as "submit this line": a carriage return. */
export const SUBMIT_BYTES: number[] = [0x0d];

/**
 * Default delay (ms) between writing the prompt text and writing the submitting
 * Enter, so the typed line registers in claude's input box before the Enter
 * submits it.
 */
export const SUBMIT_DELAY_MS = 400;

/**
 * How long claude's terminal output must be QUIET (ms) before we deliver the
 * initial prompt. claude emits a burst of setup/render output on startup, then
 * falls quiet at the ready input box; delivering only after this quiet window
 * ensures the TUI is actually accepting input (writing during the startup burst
 * is the root cause of "text not entered / Enter not registered"). Must exceed
 * the gaps WITHIN claude's startup render but be shorter than a human notices.
 */
export const READY_QUIET_MS = 700;

/**
 * Hard cap (ms) after the PTY is wired: if claude never goes quiet (continuous
 * output), deliver anyway so the prompt still lands rather than hanging forever.
 */
export const READY_MAX_MS = 8000;

/** Schedules a callback after `ms` and returns a cancellable handle (the app
 *  passes `setTimeout`; tests pass a fake clock). */
export type ScheduleAfter = (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
/** Cancels a handle from {@link ScheduleAfter} (the app passes `clearTimeout`). */
export type CancelTimer = (handle: ReturnType<typeof setTimeout>) => void;

/**
 * Decides WHEN a freshly-spawned `claude` pane is ready to receive its initial
 * prompt, then invokes `onReady` exactly once.
 *
 * `claude` emits a burst of startup/render output and then falls quiet at its
 * ready input box; we deliver after output has been QUIET for `quietMs`. Two
 * startup hazards this guards against:
 *
 *   1. Delivering BEFORE `claude` has emitted ANYTHING. A slow startup — notably
 *      a coordinated agent loading the orchestration toolkit / MCP servers — can
 *      leave the PTY silent for longer than `quietMs`. A quiet timer armed at
 *      spawn would then fire into a TUI that has not started rendering, writing
 *      the prompt into the void: the text never lands and the session shows up
 *      blank / needs-input. The quiet window therefore only starts counting
 *      AFTER the first output byte (see {@link noteOutput}).
 *   2. NEVER going quiet (continuous output). A hard cap (`maxMs`) measured from
 *      when the PTY is wired forces delivery so the prompt still lands.
 *
 * Framework-free so the timing rules are unit-tested without a DOM or live PTY:
 * the app injects `setTimeout`/`clearTimeout`, tests inject a fake clock.
 */
export class LaunchPromptReadiness {
  private sawOutput = false;
  private fired = false;
  private quiet: ReturnType<typeof setTimeout> | null = null;
  private cap: ReturnType<typeof setTimeout> | null = null;
  /** True once `wired()` has run — i.e. the PTY id is live and a write can land. */
  private isWired = false;
  /** A `fire()` that elapsed BEFORE `wired()`; replayed once the PTY is wired so the
   *  prompt isn't dropped against a not-yet-set `ptyId`. */
  private pendingFire = false;

  constructor(
    private readonly onReady: () => void,
    private readonly schedule: ScheduleAfter,
    private readonly cancel: CancelTimer,
    private readonly quietMs: number = READY_QUIET_MS,
    private readonly maxMs: number = READY_MAX_MS
  ) {}

  /** Call once the PTY is wired. Arms the hard cap; if output has ALREADY been
   *  seen (a byte arrived during the spawn round-trip), also starts the quiet
   *  window. Does NOT start the quiet window otherwise — that waits for output. */
  wired(): void {
    if (this.fired) return;
    this.isWired = true;
    if (this.cap === null) this.cap = this.schedule(() => this.fire(), this.maxMs);
    if (this.sawOutput) this.armQuiet();
    // Output may have already settled (or a stray cap elapsed) before the PTY id was
    // live; deliver now that it is.
    if (this.pendingFire) this.fire();
  }

  /** Call on every output byte: `claude` has begun rendering. (Re)starts the
   *  quiet window so delivery follows once output settles. */
  noteOutput(): void {
    if (this.fired) return;
    this.sawOutput = true;
    this.armQuiet();
  }

  /** Stop all timers (component teardown) so a torn-down pane never delivers. */
  dispose(): void {
    if (this.quiet !== null) {
      this.cancel(this.quiet);
      this.quiet = null;
    }
    if (this.cap !== null) {
      this.cancel(this.cap);
      this.cap = null;
    }
    this.fired = true;
  }

  private armQuiet(): void {
    if (this.quiet !== null) this.cancel(this.quiet);
    this.quiet = this.schedule(() => this.fire(), this.quietMs);
  }

  private fire(): void {
    if (this.fired) return;
    // The settle window (or hard cap) elapsed before the PTY id is live — the spawn
    // round-trip outran the first output byte. Delivering now would no-op against an
    // undefined `ptyId` AND latch `fired`, silently dropping the prompt. Defer instead;
    // `wired()` replays this once the id is set.
    if (!this.isWired) {
      this.pendingFire = true;
      if (this.quiet !== null) {
        this.cancel(this.quiet);
        this.quiet = null;
      }
      return;
    }
    this.fired = true;
    if (this.quiet !== null) {
      this.cancel(this.quiet);
      this.quiet = null;
    }
    if (this.cap !== null) {
      this.cancel(this.cap);
      this.cap = null;
    }
    this.onReady();
  }
}

/** Sink that forwards encoded bytes to the PTY (TerminalPane passes `pty_write`). */
export type WriteFn = (data: number[]) => void;

/** Defers the submitting Enter (the app passes `setTimeout`; tests pass a sink). */
export type ScheduleFn = (run: () => void) => void;

/**
 * Stateful, single-shot sender that delivers an optional initial prompt in TWO
 * phases and guards against double-send across re-renders. Construct once per pane
 * with the `initialInput` prop; call `deliver(write, schedule)` once the PTY is
 * wired and claude has started rendering.
 *
 * The FIRST `deliver` with a non-empty prompt writes the verbatim TEXT, then asks
 * `schedule` to run a follow-up that writes a lone carriage return — so the submit
 * is a distinct keystroke rather than the tail of a pasted block (a combined
 * `text\r` into a still-initializing TUI leaves the line entered but unsubmitted).
 * It then latches; every subsequent `deliver` is a no-op. A no-prompt sender
 * latches immediately and never writes or schedules.
 */
export class InitialInputSender {
  private delivered = false;
  private readonly text: number[] | null;

  constructor(input: string | null | undefined) {
    this.text = encodeInitialText(input);
  }

  /** Whether there is a non-empty prompt to deliver. */
  get hasPrompt(): boolean {
    return this.text !== null;
  }

  /**
   * Deliver the initial prompt exactly once. Returns `true` iff this call
   * performed the (text) write — a non-empty prompt, not yet delivered; `false`
   * on every no-op (already delivered, or nothing to send). Idempotent — safe to
   * call on every re-render. The submitting Enter is written when `schedule` runs
   * its callback (never synchronously here).
   */
  deliver(write: WriteFn, schedule: ScheduleFn): boolean {
    if (this.delivered) return false;
    this.delivered = true; // latch first, so a throwing `write` can't re-send
    if (this.text === null) return false;
    write(this.text);
    schedule(() => write(SUBMIT_BYTES));
    return true;
  }
}
