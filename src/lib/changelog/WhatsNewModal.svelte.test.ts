// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// Renders the real WhatsNewModal against the singleton store, so the rendered
// title, headings, bullets and inline runs — and the three dismissal paths
// (Esc / backdrop / "Got it") — are exercised headlessly. The persist helper is
// mocked; the singleton's changelog is the real bundled CHANGELOG.md, so the
// store is driven through `show()` after swapping its source for a fixture.

vi.mock('$lib/settings/persist', () => ({
  saveSettingsSlice: vi.fn(async () => undefined),
  loadSettings: vi.fn(async () => ({}))
}));

import WhatsNewModal from './WhatsNewModal.svelte';
import { whatsNew } from './whatsNewStore.svelte';

const MD = `# Changelog

## 0.4.0 — 2026-09-10

### New

- **Auto update**: installs on \`restart\` ([docs](https://x.y))
`;

let app: object | null = null;
afterEach(() => {
  if (app) unmount(app);
  app = null;
  whatsNew.close();
  document.body.innerHTML = '';
});

function render() {
  app = mount(WhatsNewModal, { target: document.body });
  flushSync();
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

describe('WhatsNewModal', () => {
  it('renders the running version notes as structured markup', () => {
    // Point the singleton at the fixture (its `src` is private by convention only).
    (whatsNew as unknown as { src: { version: string; dev: boolean; changelog: string } }).src = {
      version: '0.4.0',
      dev: false,
      changelog: MD
    };
    render();
    expect(dialog()).toBeNull();
    whatsNew.show();
    flushSync();
    const d = dialog()!;
    expect(d.querySelector('h2')!.textContent).toContain("What's new in Agent Desktop v0.4.0");
    expect(d.querySelector('.label')!.textContent).toBe('New');
    expect(d.querySelector('li strong')!.textContent).toBe('Auto update');
    expect(d.querySelector('li code')!.textContent).toBe('restart');
    expect(d.querySelector('li .link')!.getAttribute('title')).toBe('https://x.y');
    // No injected HTML: the bullet text is exactly the parsed runs.
    expect(d.querySelector('li')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Auto update: installs on restart (docs)'
    );
  });

  it('dialog closes', () => {
    render();
    // Escape
    whatsNew.show();
    flushSync();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(dialog()).toBeNull();
    // Backdrop click (a click INSIDE the dialog must not close it)
    whatsNew.show();
    flushSync();
    dialog()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(dialog()).not.toBeNull();
    document.querySelector<HTMLElement>('.backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    expect(dialog()).toBeNull();
    // "Got it"
    whatsNew.show();
    flushSync();
    document.querySelector<HTMLButtonElement>('button.ok')!.click();
    flushSync();
    expect(dialog()).toBeNull();
  });
});
