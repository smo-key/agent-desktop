import { describe, it, expect } from 'vitest';
import { ToastStore } from './toastStore.svelte';

describe('toast store', () => {
  it('shows a toast and dismisses it by id', () => {
    const store = new ToastStore();
    // durationMs 0 → no auto-dismiss timer, so we control the lifecycle in the test.
    const id = store.show('Build completed', 0);
    expect(store.items.map((t) => t.message)).toEqual(['Build completed']);
    store.dismiss(id);
    expect(store.items).toEqual([]);
  });

  it('stacks multiple toasts with distinct ids', () => {
    const store = new ToastStore();
    const a = store.show('one', 0);
    const b = store.show('two', 0);
    expect(a).not.toBe(b);
    expect(store.items.map((t) => t.message)).toEqual(['one', 'two']);
    store.dismiss(a);
    expect(store.items.map((t) => t.message)).toEqual(['two']);
  });
});
