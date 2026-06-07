import { describe, expect, it } from 'vitest';

// TerminalsPanelUI tests. Named `*.svelte.test.ts` so vitest compiles the `$state`
// rune. Title matches the terminals-panel `#### Scenario:` for the toggle.

import { TerminalsPanelUI } from './panel.svelte';

describe('terminals-panel — toggle', () => {
  it('Toggle the panel on', () => {
    const ui = new TerminalsPanelUI();
    expect(ui.open).toBe(false); // closed by default (zero space)
    ui.toggle();
    expect(ui.open).toBe(true);
  });

  it('toggling again hides it', () => {
    const ui = new TerminalsPanelUI();
    ui.toggle();
    ui.toggle();
    expect(ui.open).toBe(false);
  });
});

describe('terminals-panel — resizable width', () => {
  it('Panel width is resizable within bounds', () => {
    const ui = new TerminalsPanelUI();
    ui.setWidth(520);
    expect(ui.width).toBe(520);
    // Clamped below the minimum and above the maximum.
    ui.setWidth(10);
    expect(ui.width).toBe(260);
    ui.setWidth(5000);
    expect(ui.width).toBe(1000);
  });
});
