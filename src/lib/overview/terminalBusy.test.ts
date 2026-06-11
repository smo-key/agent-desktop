import { describe, expect, it } from 'vitest';
import { detectTerminalBusy } from './terminalBusy';

// PURE detection of Claude Code "actively working" affordances in recent terminal
// text (agent-status-derivation). The override that consumes this lives in
// roster.test.ts (rowFor scenarios); these cases pin the substring/regex matcher
// itself against representative TUI snippets — including the negative idle case so
// a quiet prompt never reads busy (the fail-safe).

describe('detectTerminalBusy — Claude Code active-work indicators', () => {
  it('foreground run: "esc to interrupt" affordance → busy', () => {
    // The spinner line claude renders while a command runs in the foreground.
    const text = '✻ Compiling…  (12s · esc to interrupt · ctrl+b to run in background)';
    expect(detectTerminalBusy(text)).toBe(true);
  });

  it('foreground run: "ctrl+b to run in background" affordance alone → busy', () => {
    expect(detectTerminalBusy('press ctrl+b to run in background')).toBe(true);
  });

  it('foreground run: bash-mode "! <cmd>" running spinner → busy', () => {
    const text = '✻ Running…  (3s · esc to interrupt)';
    expect(detectTerminalBusy(text)).toBe(true);
  });

  it('in-session background work: "Waiting for 1 dynamic workflow to finish" → busy', () => {
    expect(detectTerminalBusy('✻ Waiting for 1 dynamic workflow to finish')).toBe(true);
  });

  it('in-session background work: plural "Waiting for 3 dynamic workflows to finish" → busy', () => {
    expect(detectTerminalBusy('Waiting for 3 dynamic workflows to finish')).toBe(true);
  });

  it('matching is case-insensitive', () => {
    expect(detectTerminalBusy('ESC TO INTERRUPT')).toBe(true);
    expect(detectTerminalBusy('WAITING FOR 2 DYNAMIC WORKFLOWS TO FINISH')).toBe(true);
  });

  it('idle prompt with no indicator → NOT busy (fail-safe)', () => {
    const idle = [
      '╭──────────────────────────────────────────╮',
      '│ >                                          │',
      '╰──────────────────────────────────────────╯',
      '  ? for shortcuts'
    ].join('\n');
    expect(detectTerminalBusy(idle)).toBe(false);
  });

  it('empty / whitespace text → NOT busy', () => {
    expect(detectTerminalBusy('')).toBe(false);
    expect(detectTerminalBusy('   \n  \n ')).toBe(false);
  });

  it('does NOT false-positive on a "Waiting for ..." that is not a dynamic workflow count', () => {
    // The regex requires a digit + "dynamic workflow"; generic prose must not trip it.
    expect(detectTerminalBusy('Waiting for the user to respond')).toBe(false);
    expect(detectTerminalBusy('Waiting for dynamic workflow')).toBe(false);
  });
});
