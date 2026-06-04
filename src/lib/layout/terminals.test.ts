import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerTerminal,
  unregisterTerminal,
  focusTerminal,
  scrollTerminalToBottom,
  type TerminalHandle
} from './terminals';

function fakeHandle(over: Partial<TerminalHandle> = {}): TerminalHandle {
  return {
    getSelection: () => '',
    hasSelection: () => false,
    paste: () => {},
    send: () => true,
    sendKeys: () => true,
    focus: () => {},
    scrollToBottom: () => {},
    ...over
  };
}

afterEach(() => {
  unregisterTerminal('p1');
});

describe('terminal focus/scroll helpers', () => {
  it('focusTerminal calls focus() on the registered handle', () => {
    const focus = vi.fn();
    registerTerminal('p1', fakeHandle({ focus }));
    focusTerminal('p1');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('scrollTerminalToBottom calls scrollToBottom() on the registered handle', () => {
    const scrollToBottom = vi.fn();
    registerTerminal('p1', fakeHandle({ scrollToBottom }));
    scrollTerminalToBottom('p1');
    expect(scrollToBottom).toHaveBeenCalledOnce();
  });

  it('is a no-op for an unknown pane (never throws)', () => {
    expect(() => focusTerminal('nope')).not.toThrow();
    expect(() => scrollTerminalToBottom('nope')).not.toThrow();
  });
});
