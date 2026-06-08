import { describe, expect, it, vi } from 'vitest';

// The confirm-modal store: show() opens with the given prompt, confirm() runs the
// callback exactly once and closes, cancel/close() dismisses WITHOUT running it and
// clears the callback so it can never fire after dismissal. Named `*.svelte.test.ts`
// so vitest compiles the store's runes.

import { ConfirmModalStore } from './confirmStore.svelte';

describe('ConfirmModalStore', () => {
  it('show() opens with title/message and the default confirm label', () => {
    const s = new ConfirmModalStore();
    s.show({ title: 'Delete archived agents', message: 'Delete all 7?', onConfirm: () => {} });
    expect(s.open).toBe(true);
    expect(s.title).toBe('Delete archived agents');
    expect(s.message).toBe('Delete all 7?');
    expect(s.confirmLabel).toBe('Delete'); // default
  });

  it('respects a custom confirm label', () => {
    const s = new ConfirmModalStore();
    s.show({ title: 't', message: 'm', confirmLabel: 'Remove', onConfirm: () => {} });
    expect(s.confirmLabel).toBe('Remove');
  });

  it('confirm() runs the callback once and closes', () => {
    const s = new ConfirmModalStore();
    const cb = vi.fn();
    s.show({ title: 't', message: 'm', onConfirm: cb });
    s.confirm();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(s.open).toBe(false);
  });

  it('cancel/close() dismisses WITHOUT running the callback', () => {
    const s = new ConfirmModalStore();
    const cb = vi.fn();
    s.show({ title: 't', message: 'm', onConfirm: cb });
    s.close();
    expect(cb).not.toHaveBeenCalled();
    expect(s.open).toBe(false);
  });

  it('a stale callback cannot fire after close (confirm() after close is a no-op)', () => {
    const s = new ConfirmModalStore();
    const cb = vi.fn();
    s.show({ title: 't', message: 'm', onConfirm: cb });
    s.close();
    s.confirm(); // callback was cleared on close
    expect(cb).not.toHaveBeenCalled();
  });
});
