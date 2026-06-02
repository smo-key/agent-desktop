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

/** Sink that forwards encoded bytes to the PTY (TerminalPane passes `pty_write`). */
export type WriteFn = (data: number[]) => void;

/**
 * Stateful, single-shot sender that guards against double-send across re-renders.
 * Construct once per pane with the `initialInput` prop; call `trySend(write)`
 * after the PTY is wired. The FIRST call with a non-empty prompt writes the
 * encoded bytes and latches `done`; every subsequent call is a no-op. A
 * no-prompt sender also latches immediately so it can never fire later.
 */
export class InitialInputSender {
  private done = false;
  private readonly payload: number[] | null;

  constructor(input: string | null | undefined) {
    this.payload = encodeInitialInput(input);
  }

  /**
   * Send the initial input exactly once. Returns `true` iff this call performed
   * the write (a non-empty prompt, not yet sent); `false` on every no-op (already
   * sent, or nothing to send). Idempotent — safe to call on every re-render.
   */
  trySend(write: WriteFn): boolean {
    if (this.done) return false;
    this.done = true; // latch first, so a throwing `write` can't cause a re-send
    if (this.payload === null) return false;
    write(this.payload);
    return true;
  }
}
