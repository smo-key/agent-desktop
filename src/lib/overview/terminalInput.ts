// PURE accumulator for the COMMANDS a user ran in a bare shell — the signal that
// drives a terminal row's generated title (`session-titles`: "Bare terminal rows
// are titled from the commands the user ran").
//
// We do NOT read the terminal's rendered text as the title input: screen output
// changes on every chunk (a build, `tail -f`, a progress bar), which would
// re-trigger a title forever. Typed lines change only when the user actually runs
// something — structurally the same gate as a session's `user_hash`.
//
// Reconstructing a line from keystrokes is only ever a CANDIDATE, never a
// recorded command, because raw input alone is both unsafe and inaccurate:
//   - a secret typed at an echo-off prompt (`sudo`, `ssh`, and shell BUILTINS like
//     `read -s`, which never change the foreground process group and so are
//     invisible to the foreground probe) arrives on this same channel;
//   - a line the shell rewrote (tab completion, history recall, ^R search, a
//     paste) can't be tracked from input, so the reconstruction is fiction.
// So a candidate is admitted only when the CALLER confirms the shell ECHOED it
// (`recordCommand`), which both proves it wasn't typed at an echo-off prompt and
// proves the reconstruction matches what the terminal actually shows. Anything
// unverifiable is dropped — a missing command costs a slightly vaguer title; a
// wrong one is fiction and a leaked one is a secret.
//
// The joined command list IS the change key: the caller compares it for equality,
// so no hashing is needed. It lives in memory only and is never persisted.

/** The bounded state of one terminal's typed input. */
export interface InputBuffer {
  /** The line being typed (not yet submitted). */
  line: string;
  /** The last `MAX_COMMANDS` confirmed commands, oldest first. */
  commands: string[];
  /**
   * Set when the current line can no longer be trusted: an untrackable edit (tab
   * completion, history recall, ^R, a paste) or a gap in collection. A dirty line
   * yields NO candidate when it is submitted — we drop it rather than record a
   * command the user never ran.
   */
  dirty: boolean;
  /**
   * Whether we are collecting. Off until the foreground probe confirms an idle
   * prompt, and off again the moment a line is submitted (the command may be
   * about to prompt for input) until the probe re-confirms idle.
   */
  armed: boolean;
}

/** How many confirmed commands to remember (bounds the model prompt). */
export const MAX_COMMANDS = 10;
/** Hard cap on a single typed line, so a pasted blob can't grow without bound. */
export const MAX_LINE = 200;

/** An empty buffer: nothing typed, not yet armed (the probe arms it). */
export function emptyInput(): InputBuffer {
  return { line: '', commands: [], dirty: false, armed: false };
}

/** What `appendInput` produced: the new buffer plus any submitted CANDIDATE lines
 *  (in order) for the caller to confirm with `recordCommand`. */
export interface InputResult {
  buf: InputBuffer;
  candidates: string[];
}

/**
 * Apply raw terminal input `data` (what xterm's `onData` delivers) to `buf`.
 * While disarmed, nothing is tracked at all — the keystrokes belong to whatever
 * program is in the foreground — and the buffer is merely marked dirty so the
 * line that follows the gap is not recorded half-captured.
 *
 * While armed, the line is reconstructed for the pieces we can follow exactly
 * (printable characters, backspace over a whole code point, ^U/^C kill) and every
 * OTHER control — Tab, ^W, ^R, an escape sequence, a bracketed paste, a trailing
 * partial escape at a chunk boundary — marks the line dirty instead of guessing.
 * A `\r`/`\n` submits: a clean, non-blank line becomes a candidate, and the
 * buffer disarms (see `InputBuffer.armed`). Pure: never mutates `buf`.
 */
export function appendInput(buf: InputBuffer, data: string): InputResult {
  if (!buf.armed) {
    // Typed into a foreground program (or before the first probe answer): record
    // NOTHING, and mark the next line untrusted since we may have missed its start.
    return { buf: data ? { ...buf, line: '', dirty: true } : buf, candidates: [] };
  }
  let { line, commands } = buf;
  let dirty: boolean = buf.dirty;
  let armed: boolean = buf.armed;
  const candidates: string[] = [];
  let i = 0;
  while (i < data.length && armed) {
    const ch = data[i];
    if (ch === '\x1b') {
      // An escape sequence rewrites the line in ways input alone can't follow
      // (arrows / history recall / mouse reports), and one can be split across
      // chunks. Skip what we can identify and distrust the line either way.
      dirty = true;
      i++;
      if (data[i] === '[' || data[i] === 'O') {
        i++;
        while (i < data.length && !/[A-Za-z~]/.test(data[i])) i++;
        i++;
      } else {
        i++; // ESC + single char (Alt-key, vi-mode ESC)
      }
      continue;
    }
    i++;
    if (ch === '\r' || ch === '\n') {
      const cmd = line.trim();
      // Only a line we followed exactly is offered; a dirty one is dropped.
      if (cmd && !dirty) candidates.push(cmd);
      line = '';
      dirty = false;
      // A submitted command may hand the terminal to a program that prompts for
      // input (a password, a REPL). Stop collecting until the probe says idle.
      armed = false;
      continue;
    }
    if (ch === '\x7f' || ch === '\b') {
      line = dropLastCodePoint(line);
      continue;
    }
    if (ch === '\x15' || ch === '\x03') {
      line = ''; // ^U kill-line / ^C abandon — a clean reset
      dirty = false;
      continue;
    }
    if (ch < ' ') {
      // Tab completion, ^W, ^R, ^A/^E … all rewrite the line invisibly to us.
      dirty = true;
      continue;
    }
    if (line.length < MAX_LINE) line += ch;
    else dirty = true; // truncated — no longer the real line
  }
  // Input that arrived after the submit that disarmed us belongs to the next
  // program, exactly like the disarmed branch above.
  if (i < data.length) dirty = true;
  return { buf: { line, commands, dirty, armed }, candidates };
}

/** Drop one whole code point (so a backspace over an emoji can't leave a lone
 *  surrogate in the string we hand to the backend). */
function dropLastCodePoint(line: string): string {
  if (!line) return line;
  const cp = line.codePointAt(line.length - 2);
  const wide = cp !== undefined && cp > 0xffff;
  return line.slice(0, wide ? -2 : -1);
}

/**
 * Record a candidate the caller CONFIRMED the shell echoed. This is the only way
 * a command enters the list: an unechoed candidate was typed at a password /
 * hidden prompt, and a candidate that doesn't match the screen was rewritten by
 * the shell — neither is recorded. Oldest entries drop past `MAX_COMMANDS`. Pure.
 */
export function recordCommand(buf: InputBuffer, command: string): InputBuffer {
  const cmd = command.trim();
  if (!cmd) return buf;
  const commands = [...buf.commands, cmd];
  return {
    ...buf,
    commands: commands.length > MAX_COMMANDS ? commands.slice(commands.length - MAX_COMMANDS) : commands
  };
}

/**
 * Apply the foreground probe's answer: an idle prompt (`false`) ARMS collection;
 * a running job (`true`) disarms it AND discards the in-progress line, so
 * keystrokes half-captured before the probe caught up can never be carried into
 * the next command. An unknown answer (`null`/`undefined`, e.g. a non-Unix
 * platform) is treated as "not idle" — the conservative side. Pure.
 */
export function noteProbe(buf: InputBuffer, foregroundBusy: boolean | null | undefined): InputBuffer {
  if (foregroundBusy === false) {
    return buf.armed ? buf : { ...buf, armed: true };
  }
  if (!buf.armed && !buf.line) return buf;
  return { ...buf, armed: false, line: '', dirty: true };
}

/**
 * The change key + model input for a buffer: its confirmed commands joined by
 * newlines, or null when none have been confirmed yet (an untouched shell is
 * never titled).
 */
export function commandsText(buf: InputBuffer): string | null {
  return buf.commands.length ? buf.commands.join('\n') : null;
}

/**
 * How many rendered lines of the terminal tail the ECHO check looks at. Small on
 * purpose: the echoed command sits on the current input line(s), and a wide scan
 * would let a short unechoed secret "match" an unrelated earlier line.
 */
export const ECHO_SCAN_LINES = 3;

/** Shortest candidate the echo check will confirm: a 1-character line is too
 *  likely to appear somewhere in the tail by chance. */
const MIN_ECHO_LEN = 2;

/**
 * Whether `command` appears in the terminal's rendered tail — i.e. the shell
 * ECHOED it, so it was typed at a normal (visible) prompt and our reconstruction
 * matches the screen. Whitespace is ignored on both sides so a command that
 * WRAPPED across rows still matches. A password at an echo-off prompt never
 * appears and is therefore never confirmed. Pure.
 */
export function echoedIn(tailText: string, command: string): boolean {
  const cmd = command.replace(/\s+/g, '');
  if (cmd.length < MIN_ECHO_LEN) return false;
  return tailText.replace(/\s+/g, '').includes(cmd);
}
