## 1. Preference store (TDD)

- [ ] 1.1 Add failing tests in `src/lib/settings/keepAwake.test.ts` titled exactly after the scenarios: "Keep-awake preference persists in settings", "Malformed keep-awake preference falls back to never", "Never mode never holds the inhibitor", "App-open mode holds the inhibitor while the app runs", "Agent-running mode holds the inhibitor only while an agent is In flight"
- [ ] 1.2 Implement `src/lib/settings/keepAwake.svelte.ts`: `KEEP_AWAKE_MODES`, `KeepAwakeMode`, `parseKeepAwakePrefs`, pure `shouldKeepAwake(mode, anyAgentWorking)`, `KeepAwakeStore` (load/setMode/save via `saveSettingsSlice('keepAwake', …)`), singleton `keepAwake`

## 2. Backend inhibitor (TDD)

- [ ] 2.1 Add `src-tauri/src/power.rs` with a pure `Inhibitor` transition state and Rust tests named `acquire_and_release_are_idempotent` and `inhibitor_is_released_when_the_app_closes` (release-on-drop / explicit release path)
- [ ] 2.2 Implement platform shims: macOS `caffeinate -i -s -w <pid>` child (kill on release), Windows dedicated thread calling `SetThreadExecutionState` via a direct `kernel32` extern, Linux `systemd-inhibit` child when present, no-op elsewhere; all failures logged, never returned as errors
- [ ] 2.3 Register `pub mod power`, managed `power::PowerState`, the `keep_awake_set(enabled: bool)` command in `generate_handler!`, and release the inhibitor in the `CloseRequested` handler in `src-tauri/src/lib.rs`

## 3. Frontend driver + Settings UI

- [ ] 3.1 Add a driver test "Inhibitor toggles only on transitions" for a pure `keepAwakeTransition(prev, next)` helper (or equivalent) and implement it
- [ ] 3.2 Hydrate `keepAwake.load()` in `src/routes/+page.svelte` and add an `$effect` next to the alerts driver that resolves `shouldKeepAwake(keepAwake.mode, alertRows.some(isWorking))` and invokes `keep_awake_set` only on transitions (release on teardown)
- [ ] 3.3 Add a **Power** section to `src/lib/ui/SettingsModal.svelte` with a "Keep computer awake" `Dropdown` (Never / While any agent is running / While the app is open)

## 4. Gates + verify

- [ ] 4.1 Add `'keep-awake'` to `ENFORCED_CAPABILITIES` in `tools/check-scenario-coverage.mjs`, and add the DOM-only "Keep-awake is configurable from Settings" scenario to its `MANUAL_SCENARIOS`
- [ ] 4.2 Run `yarn check`, `yarn test`, `yarn coverage`, `yarn lint:storage`, and `cargo test` in `src-tauri`; confirm all pass
- [ ] 4.3 Run `openspec validate add-keep-awake` and confirm the change is well-formed
