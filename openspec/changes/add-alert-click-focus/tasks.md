## 1. Rust: custom macOS notification command

- [x] 1.1 Add `mac-notification-sys` as a direct dependency in `src-tauri/Cargo.toml` (already present transitively; pin a compatible version).
- [x] 1.2 Add a `notify_agent` Tauri command (macOS-gated with `#[cfg(target_os = "macos")]`) taking `{ pane_id, title, body }`; on non-macOS provide a no-op/absent variant so the command set still builds.
- [x] 1.3 In the command, send the notification on a blocking thread using `Notification::new().wait_for_click(true)` and, on `NotificationResponse::Click`, emit a `agent-notification-activated` event to the main window carrying `{ paneId }`. Swallow/return errors gracefully (never panic the thread).
- [x] 1.4 Register the command in the Tauri builder (`invoke_handler`) in `src-tauri/src/lib.rs`.
- [x] 1.5 Add `core:window:allow-set-focus`, `core:window:allow-unminimize`, and `core:window:allow-show` to `src-tauri/capabilities/default.json`.
- [x] 1.6 Before `send()`, call `set_application(&app.config().identifier)` once. Without it, the crate's lazy `ensure_application_set()` resolves the magic sentinel app name `"use_default"` via LaunchServices, which on recent macOS pops an interactive "Where is the application 'use_default'?" chooser instead of firing the notification.

## 2. Renderer: send path + activation intent core

- [x] 2.1 Add an inbound selection-request store (e.g. `src/lib/overview/focusRequest.svelte.ts`) holding `{ paneId, nonce }`, mirroring `focusAgent`.
- [x] 2.2 Extract a pure activation-intent function (e.g. in `notify.ts` or a new `activate.ts`) mapping `(payloadPaneId, roster/navWorkspaces)` → `{ focusWindow: true, selectPaneId: string | null }` (null when no live leaf carries the pane). Unit-test it: live pane → selectPaneId set; unknown pane → null.
- [x] 2.3 In `alerts.svelte.ts` `desktopNotify`, branch on macOS: invoke `notify_agent({ paneId: row.paneId, title: notificationTitle(), body: notificationBody(row) })`; keep the existing plugin `sendNotification` for non-macOS. Share the title/body builders. Preserve the `ensureDesktopPermission` gate and error swallowing.

## 3. Renderer: window focus + selection wiring

- [x] 3.1 In the always-mounted route (`+page.svelte`), register a `listen('agent-notification-activated', …)` once at startup (clean up on teardown).
- [x] 3.2 On activation: focus the window via `getCurrentWindow().show()` → `unminimize()` → `setFocus()`; then call `view.show('overview')`; then compute the activation intent and, if `selectPaneId` is set, write `{ paneId, nonce++ }` to the focus-request store. Guard all Tauri calls so a missing shell is a no-op.
- [x] 3.3 In `Inbox.svelte`, observe the focus-request store and route a non-null request through the existing `selectAgent` path (respect the nonce so repeat activations re-select). Ignore stale/dead paneIds (no live leaf → no-op, window already focused).

## 4. Verification

- [x] 4.1 Run the test suite; ensure the new pure-intent unit tests pass and existing alerts/navigate tests are unaffected. (1065 tests pass, incl. the 2 new `activate.test.ts` scenarios.)
- [x] 4.2 Typecheck/lint (`pnpm check` / project equivalent) and `cargo check` for `src-tauri`. (`npm run check` 0 errors; `cargo check` exit 0; new file passes `cargo fmt --check`.)
- [ ] 4.3 LIVE/MANUAL on a bundled macOS build: trigger a needs-input alert, click the notification → window raises and the agent is selected; end the session then click a stale notification → window focuses only. Record the result in the change notes. **(Pending: requires a signed/bundled `.app`; not reproducible under `tauri dev` — owner to verify.)**
