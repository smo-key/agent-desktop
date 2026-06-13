# Tasks

## 1. Runtime — record self-initiated resizes and suppress redraw output

- [x] 1.1 In `src/lib/overview/roster.ts`, add `resizeAt?: number | null` to `PaneRuntime` (epoch ms of the last self-initiated terminal resize), and add `export const RESIZE_REDRAW_MS = 750;` near the other status windows.
- [x] 1.2 In `src/lib/overview/runtime.ts`, add `noteResize(paneId, nowMs)` that records `resizeAt = nowMs` only when an entry already exists (never fabricates one, mirroring `noteStatus`).
- [x] 1.3 In `runtime.ts` `noteOutput`, skip advancing `lastOutputAt` when `resizeAt != null && nowMs - resizeAt <= RESIZE_REDRAW_MS` (still reset `exited`/`exitCode` for alive-coherence); otherwise stamp as before.

## 2. Call site

- [x] 2.1 In `src/lib/TerminalPane.svelte`, call `noteResize(paneId, Date.now())` inside the `onResize` handler (alongside the `pty_resize` invoke), so the app marks each resize it initiates.

## 3. Tests

- [x] 3.1 Unit-test `noteOutput`: output within `RESIZE_REDRAW_MS` of a `noteResize` does NOT advance `lastOutputAt` (an idle pane stays `waiting` via `deriveStatus`); output past the window advances normally (reads `working`).
- [x] 3.2 Unit-test that with no `noteResize`, `noteOutput` stamps exactly as before (fail-safe), and `noteResize` on a non-existent pane creates no entry.

## 4. Verify

- [x] 4.1 Run `npm run check` and `npm run test`; all green.
- [ ] 4.2 Manual check: select an idle agent in the overview — it stays Needs-you (no ~2.5 s In-flight flash); a genuinely working agent still reads In flight.
