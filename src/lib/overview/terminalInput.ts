// PURE accumulator for the COMMANDS a user types into a bare shell — the signal
// that drives a terminal row's generated title (`session-titles`: "Bare terminal
// rows are titled from the commands the user ran").
//
// We deliberately do NOT read the terminal's rendered text: screen output changes
// on every chunk (a build, `tail -f`, a progress bar), which would re-trigger a
// title forever. Typed commands change only when the user actually runs something
// — structurally the same gate as a session's `user_hash`.
//
// The joined command list IS the change key: the caller compares it for equality,
// so no hashing is needed. It lives in memory only and is never persisted.

/** The bounded state of one terminal's typed input. */
export interface InputBuffer {
  /** The line being typed (not yet submitted). */
  line: string;
  /** The last `MAX_COMMANDS` submitted commands, oldest first. */
  commands: string[];
}

/** How many submitted commands to remember (bounds the model prompt). */
export const MAX_COMMANDS = 10;
/** Hard cap on a single typed line, so a pasted blob can't grow without bound. */
export const MAX_LINE = 200;

/** An empty buffer. */
export function emptyInput(): InputBuffer {
  return { line: '', commands: [] };
}

/**
 * Apply raw terminal input `data` (what xterm's `onData` delivers) to `buf`,
 * returning the NEW buffer. Handles the pieces that matter for reconstructing a
 * command line:
 *  - `\r` / `\n`  → submit the current line (when non-blank) into the ring;
 *  - `\x7f` / `\b`→ backspace one character;
 *  - `\x15`       → kill the line (^U); `\x03` (^C) abandons it;
 *  - ESC sequences (arrows, history recall) and other C0 controls → ignored, so
 *    a recalled history line is simply not reconstructed rather than corrupted;
 *  - everything else → appended, clipped to `MAX_LINE`.
 * Pure: never mutates `buf`.
 */
export function appendInput(buf: InputBuffer, data: string): InputBuffer {
  let line = buf.line;
  let commands = buf.commands;
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === '\x1b') {
      // Skip an escape sequence: ESC [ / ESC O then params up to a final byte.
      i++;
      if (data[i] === '[' || data[i] === 'O') {
        i++;
        while (i < data.length && !/[A-Za-z~]/.test(data[i])) i++;
        i++;
      } else {
        i++; // ESC + single char (e.g. Alt-key)
      }
      continue;
    }
    i++;
    if (ch === '\r' || ch === '\n') {
      const cmd = line.trim();
      line = '';
      if (cmd) {
        commands = [...commands, cmd];
        if (commands.length > MAX_COMMANDS) commands = commands.slice(commands.length - MAX_COMMANDS);
      }
      continue;
    }
    if (ch === '\x7f' || ch === '\b') {
      line = line.slice(0, -1);
      continue;
    }
    if (ch === '\x15' || ch === '\x03') {
      line = ''; // ^U kill-line / ^C abandon
      continue;
    }
    // Drop remaining C0 controls (Tab completion, ^A, ^E, …): they move or rewrite
    // the line in ways we can't track, and guessing would corrupt the command.
    if (ch < ' ') continue;
    if (line.length < MAX_LINE) line += ch;
  }
  return { line, commands };
}

/**
 * The change key + model input for a buffer: its submitted commands joined by
 * newlines, or null when the user has run nothing yet (an untouched shell is
 * never titled).
 */
export function commandsText(buf: InputBuffer): string | null {
  return buf.commands.length ? buf.commands.join('\n') : null;
}

/**
 * Whether typed input should be COLLECTED right now, given the foreground probe's
 * last answer for that pane. Only an idle prompt (`false` — no foreground job)
 * qualifies: while a child process is in the foreground the keystrokes belong to
 * IT (a password prompt, a REPL, an editor), and must never be collected or sent
 * to a title model. An unknown probe result (`null`/`undefined`, e.g. non-Unix)
 * is treated as "not idle" — the conservative side. Pure.
 */
export function shouldCollect(foregroundBusy: boolean | null | undefined): boolean {
  return foregroundBusy === false;
}
