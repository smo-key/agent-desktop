## Why

Launching or resuming an agent has a visible gap: the PTY spawns, `claude`'s TUI emits a burst of setup/render output, and (for a launch with an initial prompt) the app waits for that output to settle before injecting the prompt. During this window the pane shows a blank black rectangle or a half-drawn TUI — it reads as "nothing is happening" or "did my click work?". A small spinner with a "Starting…"/"Resuming…" label fills that gap so the pane always communicates that the agent is coming up.

## What Changes

- When an **agent pane** (`claude`) spawns, overlay a centered spinner + label covering the pane until the agent is ready. Shell panes show nothing (they start instantly).
- The label is **"Resuming…"** when the pane is restored from a prior session (`--resume`), otherwise **"Starting…"**.
- The overlay clears when the agent is ready:
  - a pane **without** an initial prompt (a plain new session, or a resumed pane) clears on the **first PTY output** — the TUI has begun rendering;
  - a pane **with** an initial prompt holds the spinner through the startup burst and clears only when the **prompt is injected**, so the empty input box never flashes before the text lands;
  - an agent that **exits before becoming ready** clears the spinner too, so a process that dies on launch never spins forever.
- The overlay matches the terminal background and is `pointer-events: none` (purely visual; never intercepts a click), and respects `prefers-reduced-motion` (label without rotation).

## Capabilities

### New Capabilities
- `agent-launch-spinner`: a launch/resume loading overlay (spinner + "Starting…"/"Resuming…" label) shown on an agent pane from spawn until the agent is ready, with readiness keyed off first output (promptless/resumed) or prompt injection (prompt-bearing), and cleared on early exit.

### Modified Capabilities
<!-- None: session-launcher's base spec is still an unarchived change (add-agent-desktop), so this ships as a self-contained capability rather than a delta against it. -->

## Impact

- **Frontend** — `src/lib/launcher/spinner.ts` (new): pure, framework-free readiness model (`LaunchSpinner`) + `spinnerLabel`, unit-tested in `spinner.test.ts`.
- **Frontend** — `src/lib/TerminalPane.svelte`: construct the `LaunchSpinner` at mount from launch-time props (`program`, `initialInput`, `resume`), mirror its `loading` into reactive state at the existing output/inject/exit sites, and render the overlay markup + CSS.
- No backend, dependency, or protocol changes.
