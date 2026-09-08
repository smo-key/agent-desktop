import { describe, expect, it } from 'vitest';
import { showTerminalsDock, terminalsCombined } from './placement';

// tasks-panel: the dock and its title-bar toggle are hidden whenever terminals are
// combined into the sessions list, whatever the toggle state; in the separate
// placement the dock follows the toggle as before.
describe('terminals placement', () => {
  it('The dock and its toggle are hidden in combined placement', () => {
    expect(showTerminalsDock('combined', true)).toBe(false);
    expect(showTerminalsDock('combined', false)).toBe(false);
    expect(showTerminalsDock('panel', true)).toBe(true);
    expect(showTerminalsDock('panel', false)).toBe(false);
    expect(terminalsCombined('combined')).toBe(true);
    expect(terminalsCombined('panel')).toBe(false);
  });
});
