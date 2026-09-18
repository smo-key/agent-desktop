## Why

Long-running agent sessions die when the Mac (or PC) goes to sleep: the agent's network connection to the API drops mid-turn and the work is lost or has to be resumed by hand. Today the only workaround is to change OS power settings or run `caffeinate` by hand. The app already knows exactly when agents are working, so it should be able to keep the machine awake on the user's behalf.

## What Changes

- A new **Keep computer awake** preference in Settings with three modes: **Never** (default, current behavior), **While any agent is running**, and **While the app is open**.
- A backend sleep inhibitor that prevents idle system sleep while it is held: `caffeinate` on macOS, `SetThreadExecutionState` on Windows, `systemd-inhibit` on Linux when available (best-effort no-op otherwise).
- A frontend driver that resolves the preference plus the live roster into a single "should be awake" boolean and asks the backend to acquire/release the inhibitor only on transitions.
- The inhibitor is always released when the app closes (and cannot outlive the app process on macOS, where `caffeinate -w` watches the app's pid).
- The preference is stored in the durable `keepAwake` slice of `settings.json`, never in `localStorage`.

## Capabilities

### New Capabilities
- `keep-awake`: the sleep-inhibitor preference, its persistence, the resolution rule from mode + agent activity to inhibitor state, the platform inhibitor, and its release on close.

### Modified Capabilities
<!-- none — the roster's `working` predicate and the settings persistence contract are consumed, not changed -->

## Impact

- `src/lib/settings/keepAwake.svelte.ts` (new store + pure resolver), `src/lib/ui/SettingsModal.svelte` (new Power section), `src/routes/+page.svelte` (hydrate + driver effect next to the alerts driver).
- `src-tauri/src/power.rs` (new module: pure transition state + platform shims), `src-tauri/src/lib.rs` (register `keep_awake_set`, release on `CloseRequested`).
- No new Cargo dependencies: macOS spawns the system `caffeinate` binary, Windows declares the `kernel32` FFI directly, Linux spawns `systemd-inhibit` when present.
- `tools/check-scenario-coverage.mjs`: `keep-awake` added to the enforced capabilities.
