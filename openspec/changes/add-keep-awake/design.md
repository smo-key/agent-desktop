## Context

The app spawns and watches every agent (`buildRoster` → `AgentRow.status`, `isWorking(row)`), persists preferences as named slices of one `settings.json` blob (`loadSettings`/`saveSettingsSlice`, Rust `settings_load`/`settings_save`), and renders them in `SettingsModal.svelte` with a `Dropdown`. No power-management code exists in the Rust backend today, and `Cargo.toml` has no IOKit or Win32 bindings. The always-mounted needs-input-alerts driver in `+page.svelte` already rebuilds the full roster on a 1 s clock regardless of view mode, which is the right place to observe "is any agent working".

## Goals / Non-Goals

**Goals:**
- Prevent idle system sleep (so network connections survive) in the two gated modes; leave display sleep alone.
- Zero new native dependencies; best-effort on every platform; never crash or block the UI if the inhibitor cannot be acquired.
- The inhibitor never outlives the app.

**Non-Goals:**
- Preventing sleep on lid close or on battery when the OS forbids it (`caffeinate -i` cannot override a closed lid; that is an OS policy).
- Keeping the display on.
- Per-agent or per-project settings.

## Decisions

**Decision: one pure resolver `shouldKeepAwake(mode, anyAgentWorking)` in the settings module; the driver only invokes on transitions.**
`never → false`, `app-open → true`, `agent-running → anyAgentWorking`. Keeping the rule framework-free makes it unit-testable against the scenario names. The `$effect` in `+page.svelte` derives `alertRows.some(isWorking)` (the same rows the alerts driver builds, so grid and overview views behave identically) and calls `invoke('keep_awake_set', { enabled })` only when the resolved boolean changes, so the backend sees at most one call per transition, not one per tick.
- *Alternative — compute `anyWorking` in the Inbox:* rejected, the Inbox is only mounted in overview mode.

**Decision: Rust `power` module = a pure `Inhibitor` state (`set(desired) -> Option<Transition>`) + platform shims.**
The state is idempotent: `set(true)` twice acquires once; `set(false)` when not held is a no-op. Tests cover the state machine; the shims are thin:
- macOS: spawn `caffeinate -i -s -w <app pid>` and keep the `Child`; release = kill the child. `-w` makes the OS reap the inhibitor if the app dies without running the release, so no zombie `caffeinate` can ever pin the machine awake after a crash.
- Windows: a dedicated long-lived thread owns `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` and clears it with `ES_CONTINUOUS` on release. The state is per-thread and is dropped by the OS when the thread (i.e. the process) ends, so it cannot outlive the app either. Declared via a direct `extern "system"` on `kernel32` (no `windows-sys` dependency).
- Linux: spawn `systemd-inhibit --what=sleep:idle --who=agent-desktop --why=... --mode=block sleep infinity`; if the binary is missing the call logs and succeeds as a no-op.
- Other targets: no-op.
- *Alternative — `IOPMAssertionCreateWithName` via FFI:* more "native" but needs CoreFoundation string plumbing or a new crate; `caffeinate` is shipped with every macOS and already exposes the assertion. Rejected for now.

**Decision: release on `CloseRequested` in `lib.rs`, next to `kill_all()`.**
The frontend's teardown is not guaranteed to run on quit; the Rust close handler is. Together with `-w`/thread-lifetime semantics this gives three layers of release.

**Decision: default `never`, stored as `{ mode }` in the `keepAwake` slice; unknown/malformed values parse to `never`.**
Matches the other settings stores and the `ui-preferences` rule that durable prefs live in `settings.json`.

## Risks / Trade-offs

- [`caffeinate` missing or refusing to spawn] → log at warn, report success to the frontend (best-effort), no UI error.
- [`-w` requires the app pid; in dev the pid is the Tauri dev process] → still correct: the inhibitor follows whichever process spawned it.
- [The roster momentarily reads no agent working between turns] → `agent-running` mode releases and re-acquires; `caffeinate` respawn is cheap and the machine's idle timer is minutes, so a sub-second gap cannot trigger sleep. No hysteresis needed.
- [Windows: state is per-thread] → owned by a dedicated thread that lives for the process, never a Tauri command thread.
