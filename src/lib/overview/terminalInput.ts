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
  /**
   * Set between a SUBMIT and the next probe answer. Input arriving in that window
   * may be the start of the next command (type-ahead), so the line that follows it
   * is distrusted. Input arriving while disarmed by the PROBE instead belongs to
   * the running program, and the line typed after it starts fresh — so that case
   * does NOT poison the next command.
   */
  pendingSubmit: boolean;
  /**
   * When the last recorded command opens an INPUT context — a heredoc, a
   * continuation line, `read`/`select` — the lines that follow are the shell's own
   * data, not commands, and are echoed like anything else. Recording is suspended
   * from this timestamp until a child process runs (the context is over) or
   * `SUSPEND_MS` elapses, so file content and answers to a prompt never enter the
   * command list. Null when not suspended.
   */
  suspendedAt: number | null;
}

/** How many confirmed commands to remember (bounds the model prompt). */
export const MAX_COMMANDS = 10;
/** Hard cap on a single typed line, so a pasted blob can't grow without bound. */
export const MAX_LINE = 200;

/** An empty buffer: nothing typed, not yet armed (the probe arms it). */
export function emptyInput(): InputBuffer {
  return { line: '', commands: [], dirty: false, armed: false, pendingSubmit: false, suspendedAt: null };
}

/**
 * How long recording stays suspended after a command that opens an input context,
 * when no child process ever runs to close it (`read`, `select` — shell builtins).
 * Long enough to cover answering a prompt, short enough that a shell recovers.
 */
export const SUSPEND_MS = 30_000;

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
    // NOTHING. Only input in the window between a SUBMIT and the next probe answer
    // distrusts the following line — it may be that line's missing first
    // characters. Keystrokes consumed by a running program (`q` to leave a pager,
    // a REPL line) do not, so the next command typed at the prompt is collected
    // normally.
    if (!data) return { buf, candidates: [] };
    return { buf: { ...buf, line: '', dirty: buf.pendingSubmit || buf.dirty }, candidates: [] };
  }
  let { line, commands } = buf;
  let dirty: boolean = buf.dirty;
  let armed: boolean = buf.armed;
  let pendingSubmit: boolean = buf.pendingSubmit;
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
      pendingSubmit = true;
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
  return { buf: { ...buf, line, commands, dirty, armed, pendingSubmit }, candidates };
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
export function recordCommand(buf: InputBuffer, command: string, nowMs: number = Date.now()): InputBuffer {
  const cmd = command.trim();
  if (!cmd) return buf;
  // Suspended: these lines are the shell reading DATA (a heredoc body, an answer
  // to `read`), not commands the user ran. They are echoed like any other input,
  // so the echo check alone cannot tell them apart — this is what does.
  if (buf.suspendedAt != null) return buf;
  const commands = [...buf.commands, cmd];
  return {
    ...buf,
    commands: commands.length > MAX_COMMANDS ? commands.slice(commands.length - MAX_COMMANDS) : commands,
    suspendedAt: opensInputContext(cmd) ? nowMs : null
  };
}

/**
 * Whether `command` makes the shell read further lines as DATA rather than as
 * commands: a heredoc, an explicit continuation, an unbalanced quote, or a
 * builtin that prompts (`read`, `select`, `vared` — builtins never fork, so the
 * foreground probe cannot see them). Deliberately generous: a false positive only
 * costs a few uncollected commands, a false negative records file content or a
 * typed secret as a "command". Pure.
 */
export function opensInputContext(command: string): boolean {
  const cmd = command.trim();
  if (cmd.endsWith('\\')) return true; // line continuation
  if (/(^|[^<])<<(?!<)/.test(cmd)) return true; // heredoc `<<`, but not a `<<<` here-string
  if (unbalanced(cmd, "'") || unbalanced(cmd, '"')) return true;
  const head = cmd.split(/\s+/)[0];
  return head === 'read' || head === 'select' || head === 'vared';
}

/** Whether `quote` appears an odd number of times in `text`. */
function unbalanced(text: string, quote: string): boolean {
  let n = 0;
  for (const ch of text) if (ch === quote) n++;
  return n % 2 === 1;
}

/**
 * Apply the foreground probe's answer: an idle prompt (`false`) ARMS collection;
 * a running job (`true`) disarms it AND discards the in-progress line, so
 * keystrokes half-captured before the probe caught up can never be carried into
 * the next command. An unknown answer (`null`/`undefined`, e.g. a non-Unix
 * platform) is treated as "not idle" — the conservative side. Pure.
 */
export function noteProbe(
  buf: InputBuffer,
  foregroundBusy: boolean | null | undefined,
  nowMs: number = Date.now()
): InputBuffer {
  if (foregroundBusy === false) {
    // An input context with no child to end it (`read`) expires on a timer.
    const suspendedAt =
      buf.suspendedAt != null && nowMs - buf.suspendedAt > SUSPEND_MS ? null : buf.suspendedAt;
    if (buf.armed && !buf.pendingSubmit && suspendedAt === buf.suspendedAt) return buf;
    return { ...buf, armed: true, pendingSubmit: false, suspendedAt };
  }
  // A child process is running: whatever is half-typed belongs to it, and any
  // input context the previous command opened is over. The line is dropped but the
  // buffer is NOT marked dirty — the next line is typed fresh at the prompt once
  // the program exits, and poisoning it would cost the command after every pager,
  // REPL or interactive prompt. (A probe that reports busy while the user is
  // mid-line — a prompt hook forking a subprocess — can therefore clip that one
  // line's start; the result is a slightly shortened command in a title, never a
  // secret, since anything typed while disarmed is dropped outright.)
  // Dirty is CLEARED here for the same reason: a `true` answer proves the
  // keystrokes we ignored went to that program, so they were not the missing start
  // of the next command. (An `idle` answer proves the opposite — nothing was
  // running, so the typing really was type-ahead into the shell's line — and there
  // the dirty flag stands and the next line is dropped.)
  return { ...buf, armed: false, pendingSubmit: false, line: '', dirty: false, suspendedAt: null };
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
 * Whether `command` is what the terminal shows at the END of the input line — i.e.
 * the shell ECHOED it, so it was typed at a normal (visible) prompt and our
 * reconstruction matches the screen. `tailText` must be the text UP TO the cursor
 * (the prompt plus the line being submitted); whitespace is ignored on both sides
 * so a command that WRAPPED across rows still matches.
 *
 * The match is a SUFFIX, not a substring: a substring test confirms a
 * reconstruction that lost characters mid-line (a shell rewrite we failed to
 * track), recording a command that was never run. A password at an echo-off
 * prompt never appears at all and is therefore never confirmed. Pure.
 */
export function echoedIn(tailText: string, command: string): boolean {
  const cmd = command.replace(/\s+/g, '');
  if (cmd.length < MIN_ECHO_LEN) return false;
  return tailText.replace(/\s+/g, '').endsWith(cmd);
}
