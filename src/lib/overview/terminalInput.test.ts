import { describe, expect, it } from 'vitest';
import {
  MAX_COMMANDS,
  appendInput,
  commandsText,
  emptyInput,
  shouldCollect
} from './terminalInput';

/** Feed a string through the accumulator from empty. */
function run(...chunks: string[]) {
  let buf = emptyInput();
  for (const c of chunks) buf = appendInput(buf, c);
  return buf;
}

describe('terminal typed-input accumulator', () => {
  it('Typed commands accumulate at an idle prompt', () => {
    const buf = run('yarn ', 'test\r', 'git stat');
    expect(buf.commands).toEqual(['yarn test']);
    // The unsubmitted line is not part of the change key yet.
    expect(commandsText(buf)).toBe('yarn test');
    expect(buf.line).toBe('git stat');
  });

  it('applies backspace, kill-line and control keys', () => {
    expect(run('lz\x7fs -la\r').commands).toEqual(['ls -la']);
    expect(run('rm -rf /\x15echo hi\r').commands).toEqual(['echo hi']);
    expect(run('oops\x03ls\r').commands).toEqual(['ls']);
    // A recalled history line (arrow keys) is ignored rather than corrupted.
    expect(run('\x1b[A\x1b[Bls\r').commands).toEqual(['ls']);
    // A blank Return submits nothing.
    expect(run('\r\r').commands).toEqual([]);
    expect(commandsText(emptyInput())).toBeNull();
  });

  it('caps the remembered commands at the ring size', () => {
    let buf = emptyInput();
    for (let i = 0; i < MAX_COMMANDS + 3; i++) buf = appendInput(buf, `cmd${i}\r`);
    expect(buf.commands).toHaveLength(MAX_COMMANDS);
    expect(buf.commands[0]).toBe('cmd3');
    expect(buf.commands.at(-1)).toBe(`cmd${MAX_COMMANDS + 2}`);
  });

  it('Input to a running job is not collected', () => {
    expect(shouldCollect(false)).toBe(true); // idle prompt
    expect(shouldCollect(true)).toBe(false); // a foreground job owns the keystrokes
    expect(shouldCollect(null)).toBe(false); // unknown probe → conservative
    expect(shouldCollect(undefined)).toBe(false);
  });
});
