import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

// The component's store/model imports transitively pull in the Tauri core API.
// Nothing is invoked during a render (only inside click handlers), but the module
// must import, so stub `invoke`/`Channel`.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));

import ModelOnboarding from './ModelOnboarding.svelte';

describe('ModelOnboarding', () => {
  // The gate takes over the BODY area only — it sits below the app's persistent
  // titlebar (offset by --titlebar-h), so the titlebar keeps the window draggable
  // during the one-time download and the gate itself is NOT a window-drag region.
  // Guard that the takeover does not re-introduce its own `data-tauri-drag-region`
  // (which would mean it is covering / overriding the titlebar again).
  it('does not declare its own window-drag region (the titlebar provides it)', () => {
    const { body } = render(ModelOnboarding);
    expect(body).not.toMatch(/data-tauri-drag-region/);
  });

  it('renders the model-download gate dialog with a download action', () => {
    const { body } = render(ModelOnboarding);
    expect(body).toMatch(/role="dialog"/);
    expect(body).toMatch(/Download models/);
  });
});
