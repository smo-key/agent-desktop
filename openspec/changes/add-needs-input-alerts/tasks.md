## 1. Pure alert core (`notify.ts`)

- [ ] 1.1 Write `src/lib/overview/notify.test.ts`: cover `newlyNeedsAttention(prev, rows)` edge detection (entry fires; staying does not; re-entry fires; paused/archived/preview excluded) and `shouldAlert(row, mode, ctx)` across all four modes × focus/viewed-agent combinations (per the `needs-input-alerts` spec scenarios).
- [ ] 1.2 Implement `src/lib/overview/notify.ts`: export `AlertMode` type, `newlyNeedsAttention` (set-diff over `needsAttention` rows), and `shouldAlert`. Framework-free (no Svelte/Tauri/browser imports). Make 1.1 pass.

## 2. Settings store (`notifications.svelte.ts`)

- [ ] 2.1 Write `src/lib/settings/notifications.test.ts` for the pure `parseNotificationPrefs`: fresh/missing slice → both `off`; valid modes load; non-object / unknown / missing mode → falls back to `off` per channel.
- [ ] 2.2 Implement `src/lib/settings/notifications.svelte.ts` mirroring `autoAdvance.svelte.ts`: `NotificationPrefs` (`{ sound: { mode }, desktop: { mode } }`), `DEFAULT_NOTIFICATION_PREFS` (both `off`), pure `parseNotificationPrefs`, `NotificationStore` with `prefs`/`loaded`/`load()`/`setSoundMode`/`setDesktopMode`, persisting the `notifications` slice via `saveSettingsSlice`. Singleton export. Make 2.1 pass.

## 3. Window-focus store (`windowFocus.svelte.ts`)

- [ ] 3.1 Implement `src/lib/overview/windowFocus.svelte.ts`: a reactive `appFocused` store derived from `window` `focus`/`blur` + `document.visibilitychange` (focused = has focus AND document visible), with start/stop listener wiring guarded for non-browser/SSR. (Live-wired; no unit test.)

## 4. Tauri notification plugin wiring

- [ ] 4.1 Add `@tauri-apps/plugin-notification` to `package.json` dependencies and install.
- [ ] 4.2 Add `tauri-plugin-notification` to `src-tauri/Cargo.toml` and register it in `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_notification::init())`).
- [ ] 4.3 Grant `notification:default` in `src-tauri/capabilities/default.json`.

## 5. Reactive alert shell (`alerts.svelte.ts`)

- [ ] 5.1 Implement `src/lib/overview/alerts.svelte.ts`: an `AlertController` holding the primed/`prev` attention set; a `process(rows, ctx)` that primes on first observation (fires nothing), computes `newlyNeedsAttention`, and for each new row fires the sound chime when `shouldAlert(row, prefs.sound.mode, ctx)` and the desktop notification when `shouldAlert(row, prefs.desktop.mode, ctx)`.
- [ ] 5.2 Implement `playChime()` (lazy `AudioContext`, two-tone oscillator ding, resumed on first use) and `desktopNotify(row)` (permission check/request via `@tauri-apps/plugin-notification`; `sendNotification({ title, body })` with title "Agent needs input" and body = name + clipped question/summary; swallow errors in non-Tauri/denied contexts).

## 6. Inbox integration

- [ ] 6.1 In `src/lib/overview/Inbox.svelte`, compute `viewedPaneId` (inbox focus agent in overview mode, else `workspace.focusedId` in grid mode) and call the alert controller's `process(allRows, { appFocused, viewedPaneId })` from the existing per-second roster `$effect`.

## 7. Settings UI

- [ ] 7.1 Add a "Notifications" section to `src/lib/ui/SettingsModal.svelte`: two mode pickers (Sound, Desktop notification) each offering Never / App in background / Not viewing the agent / Always, bound to `notifications.setSoundMode` / `setDesktopMode`; load on mount. Reflect a denied-permission state on the desktop picker where detectable.

## 8. Verify

- [ ] 8.1 Run `npm run check:gate` (type-check, tests, coverage) and fix any failures.
- [ ] 8.2 Manual smoke in `npm run dev`: configure each mode, confirm sound and desktop alerts fire on a real agent entering Needs input under the expected focus/view conditions, and that defaults are silent.
