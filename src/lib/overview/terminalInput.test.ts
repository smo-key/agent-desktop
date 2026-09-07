import { describe, expect, it } from 'vitest';
import {
  MAX_COMMANDS,
  appendInput,
  commandsText,
  echoedIn,
  emptyInput,
  noteProbe,
  recordCommand
} from './terminalInput';

/** A shell sitting at an idle prompt (the probe has armed collection). */
const idle = () => noteProbe(emptyInput(), false);

/**
 * Type `data` into `buf` and record every candidate the (simulated) shell echoed.
 * `echo` stands in for TerminalPane's screen check: by default the shell echoes
 * everything, as it does at a normal visible prompt.
 */
function type(buf = idle(), data: string, echo: (cmd: string) => boolean = () => true) {
  const { buf: next, candidates } = appendInput(buf, data);
  return candidates.reduce((b, cmd) => (echo(cmd) ? recordCommand(b, cmd) : b), next);
}

describe('terminal typed-input accumulator', () => {
  it('Typed commands accumulate at an idle prompt', () => {
    let buf = type(idle(), 'yarn ');
    buf = type(buf, 'test\r');
    expect(buf.commands).toEqual(['yarn test']);
    expect(commandsText(buf)).toBe('yarn test');
    // Submitting disarms; the next command is collected once the probe re-confirms
    // the prompt is idle.
    expect(buf.armed).toBe(false);
    buf = type(noteProbe(buf, false), 'git status\r');
    expect(buf.commands).toEqual(['yarn test', 'git status']);
  });

  it('applies backspace, kill-line and blank lines', () => {
    expect(type(idle(), 'lz\x7fs -la\r').commands).toEqual(['ls -la']);
    expect(type(idle(), 'rm -rf /\x15echo hi\r').commands).toEqual(['echo hi']);
    expect(type(idle(), 'oops\x03ls\r').commands).toEqual(['ls']);
    expect(type(idle(), '\r\r').commands).toEqual([]);
    expect(commandsText(emptyInput())).toBeNull();
    // Backspace removes a WHOLE code point, so no lone surrogate can escape.
    expect(type(idle(), 'a\u{1F600}\x7fb\r').commands).toEqual(['ab']);
  });

  it('drops a line the shell rewrote instead of guessing at it', () => {
    // Tab completion, ^R search and history recall all rewrite the line where we
    // cannot follow: the line is dropped rather than recorded as a command the
    // user never ran.
    expect(type(idle(), 'ya\tst\r').commands).toEqual([]);
    expect(type(idle(), '\x12pass\r').commands).toEqual([]);
    expect(type(idle(), '\x1b[A --amend\r').commands).toEqual([]);
    // An escape split across two chunks is likewise distrusted, not reassembled.
    let buf = type(idle(), '\x1b');
    buf = type(buf, '[Als\r');
    expect(buf.commands).toEqual([]);
    // A bracketed paste is text the shell inserted, not necessarily a command.
    expect(type(idle(), '\x1b[200~echo hi\x1b[201~\r').commands).toEqual([]);
  });

  it('Input to a running job is not collected', () => {
    // A command that starts a program disarms collection AT THE SUBMIT, so the
    // password typed at its prompt is never seen — and is not carried into the
    // next command either, even though the 1 Hz probe only catches up later.
    let buf = type(idle(), 'sudo -k true\r');
    expect(buf.commands).toEqual(['sudo -k true']);
    buf = type(buf, 'hunter2\r'); // typed at sudo's prompt, before any probe answer
    expect(buf.commands).toEqual(['sudo -k true']);
    buf = noteProbe(buf, true); // the probe finally reports the running job
    expect(buf.line).toBe('');
    buf = type(noteProbe(buf, false), 'ls\r'); // back at the prompt
    // No fragment of the password survived into the next command.
    expect(buf.commands).toEqual(['sudo -k true']);
    expect(commandsText(buf)).toBe('sudo -k true');
  });

  it('An unechoed line is never recorded', () => {
    // A shell BUILTIN like `read -s` never changes the foreground process group,
    // so the probe still reports an idle prompt — the echo check is what keeps the
    // secret out.
    const buf = type(idle(), 'secret-value\r', () => false);
    expect(buf.commands).toEqual([]);
    expect(echoedIn('$ ls -la\nfile.txt\n$ ', 'ls -la')).toBe(true);
    // A line that WRAPPED across rows still matches (whitespace is ignored).
    expect(echoedIn('$ git commit -m "a very long\nmessage here"', 'git commit -m "a very long message here"')).toBe(true);
    expect(echoedIn('$ ls -la\nfile.txt\n$ ', 'hunter2')).toBe(false);
    // Too short to confirm: a single character could match anything on screen.
    expect(echoedIn('$ q\n', 'q')).toBe(false);
  });

  it('caps the remembered commands at the ring size', () => {
    let buf = idle();
    for (let i = 0; i < MAX_COMMANDS + 3; i++) buf = recordCommand(buf, `cmd${i}`);
    expect(buf.commands).toHaveLength(MAX_COMMANDS);
    expect(buf.commands[0]).toBe('cmd3');
    expect(buf.commands.at(-1)).toBe(`cmd${MAX_COMMANDS + 2}`);
    expect(recordCommand(buf, '   ')).toBe(buf); // a blank confirmation is a no-op
  });
});
