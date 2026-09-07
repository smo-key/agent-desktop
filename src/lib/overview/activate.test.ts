import { describe, expect, it } from 'vitest';
import { backendFor } from '$lib/agent/backends';
import { activationIntent } from './activate';
import type { NavWorkspace } from './navigate';

// Tests for the PURE notification-activation intent (capability
// `alert-click-focus`). The `it(...)` titles are the EXACT `#### Scenario:` names
// from the spec so the scenario-coverage gate maps them here. The window focus +
// the Tauri listen/getCurrentWindow calls are LIVE/MANUAL; this asserts only the
// "select the live agent vs focus-window-only" decision.

/** A single-leaf workspace whose one leaf carries `paneId`. */
function leafWs(id: string, leafId: string, paneId: string): NavWorkspace {
  return { id, root: { type: 'leaf', id: leafId, paneId } };
}

describe('activate — notification activation intent', () => {
  it('Clicking a live agent’s notification focuses that agent', () => {
    const workspaces: NavWorkspace[] = [
      leafWs('ws-1', 'leaf-a', 'pane-a'),
      leafWs('ws-2', 'leaf-b', 'pane-b')
    ];
    // A live pane resolves to a select intent for that exact pane.
    expect(activationIntent('pane-b', workspaces)).toEqual({
      focusWindow: true,
      selectPaneId: 'pane-b'
    });
  });

  it('An activation for an unknown pane is a no-op selection', () => {
    const workspaces = [leafWs('ws-1', 'leaf-a', 'pane-a')];
    // A stale/ended session: focus the window but select nothing.
    expect(activationIntent('pane-gone', workspaces)).toEqual({
      focusWindow: true,
      selectPaneId: null
    });
    expect(activationIntent('pane-a', [])).toEqual({
      focusWindow: true,
      selectPaneId: null
    });
  });
});

describe('copilot pending-question activation (copilot-observability)', () => {
  it('Activation focuses the pane when driving is unsupported', () => {
    // Copilot declares no in-TUI question driving (askUserDriving: false), so
    // activating its pending-question alert resolves to the same
    // focus-window + select-pane intent — the operator answers in the terminal.
    expect(backendFor('copilot').capabilities.askUserDriving).toBe(false);
    const workspaces = [leafWs('ws-1', 'leaf-a', 'pane-cop')];
    expect(activationIntent('pane-cop', workspaces)).toEqual({
      focusWindow: true,
      selectPaneId: 'pane-cop'
    });
  });
});
