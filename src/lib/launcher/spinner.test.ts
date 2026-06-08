import { describe, expect, it } from 'vitest';
import { spinnerLabel, LaunchSpinner } from './spinner';

// The agent-launch spinner overlays a freshly-spawned (or resumed) agent pane
// with a "Starting…"/"Resuming…" label until the agent is ready. `spinnerLabel`
// picks the wording; `LaunchSpinner` models when the overlay should clear. Both
// are framework-free so the readiness rules are unit-tested without xterm/Tauri.
//
// NB: the `it(...)` titles here are the spec scenario titles for the
// `agent-launch-spinner` capability — keep them in sync (the scenario-coverage
// gate matches scenario title -> test title).

describe('LaunchSpinner', () => {
  it('Agent pane shows a launch spinner while starting', () => {
    expect(new LaunchSpinner({ isAgent: true, hasPrompt: false }).loading).toBe(true);
  });

  it('Shell pane shows no launch spinner', () => {
    const s = new LaunchSpinner({ isAgent: false, hasPrompt: false });
    expect(s.loading).toBe(false);
    // Output on a shell pane keeps it cleared (it never started loading).
    s.onOutput();
    expect(s.loading).toBe(false);
  });

  it('Promptless agent clears the spinner on first output', () => {
    const s = new LaunchSpinner({ isAgent: true, hasPrompt: false });
    s.onOutput();
    expect(s.loading).toBe(false);
  });

  it('Resumed agent clears the spinner on first output', () => {
    // A resumed pane carries no initial prompt, so it clears as soon as the
    // restored transcript begins rendering — same path as a plain new session.
    const s = new LaunchSpinner({ isAgent: true, hasPrompt: false });
    s.onOutput();
    expect(s.loading).toBe(false);
  });

  it('Prompt-bearing agent holds the spinner until the prompt is injected', () => {
    const s = new LaunchSpinner({ isAgent: true, hasPrompt: true });
    s.onOutput();
    // Still loading: we must not flash the empty input box before the prompt lands.
    expect(s.loading).toBe(true);
    s.onInjected();
    expect(s.loading).toBe(false);
  });

  it('Spinner clears if the agent exits before becoming ready', () => {
    const s = new LaunchSpinner({ isAgent: true, hasPrompt: true });
    s.onExit();
    expect(s.loading).toBe(false);
  });
});

describe('spinnerLabel', () => {
  it('Resuming label for a resumed pane', () => {
    expect(spinnerLabel(true)).toBe('Resuming…');
  });

  it('Starting label for a fresh launch', () => {
    expect(spinnerLabel(false)).toBe('Starting…');
    // An absent resume flag is a fresh launch too.
    expect(spinnerLabel(undefined)).toBe('Starting…');
  });
});
