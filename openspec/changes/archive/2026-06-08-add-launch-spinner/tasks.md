## 1. Readiness model (pure)

- [x] 1.1 Add `src/lib/launcher/spinner.ts`: `spinnerLabel(resume)` → "Resuming…"/"Starting…", and a framework-free `LaunchSpinner` class (`{ isAgent, hasPrompt }` → `loading`, with `onOutput()`/`onInjected()`/`onExit()`/`onTimeout()`) encoding the clear rules.
- [x] 1.2 Add `src/lib/launcher/spinner.test.ts` covering every scenario: agent-shows / shell-hides, promptless-clears-on-output, resumed-clears-on-output, prompt-bearing-holds-until-injected, clears-on-early-exit, clears-on-timeout-backstop, and both labels. (TDD: tests written first, fail on missing module, then pass.)

## 2. Render the overlay in TerminalPane

- [x] 2.1 In `TerminalPane.svelte`, construct the `LaunchSpinner` in `onMount` from the launch-time props (`program`, `initialInput` via the existing `InitialInputSender`, `resume`); mirror `loading` into reactive `$state` and set the fixed `loadingLabel`.
- [x] 2.2 Drive the model at the existing sites: `onOutput()` on the first `data` event, `onInjected()` after `deliverInitial` delivers, `onExit()` on the `exit` event — re-mirroring `loading` each time. Arm a `READY_MAX_MS` backstop timer (`onTimeout()`) at mount for agent panes, cleared in `onDestroy`.
- [x] 2.3 Render the overlay (`{#if loading}`) with a `role="status"` spinner + label, an opaque terminal-background cover, `pointer-events: none`, and a `prefers-reduced-motion` fallback.

## 3. Verify

- [x] 3.1 `npm run check` (0 errors, 0 warnings) and `npm run test` (full suite green).
- [x] 3.2 `npm run coverage` — `agent-launch-spinner` scenarios map to the `spinner.test.ts` titles.
