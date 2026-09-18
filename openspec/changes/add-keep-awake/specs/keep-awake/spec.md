## ADDED Requirements

### Requirement: Keep-awake preference persists in settings

The application SHALL offer a **Keep computer awake** preference with exactly three modes — `never` (default), `agent-running`, and `app-open` — persisted in the durable `keepAwake` slice of `settings.json` (never `localStorage`), loaded once on startup, and saved on every change without clobbering sibling slices. The preference SHALL be configurable from the Settings modal.

#### Scenario: Keep-awake preference persists in settings
- **WHEN** the user selects a keep-awake mode
- **THEN** the `keepAwake` slice of `settings.json` is written with that mode, merged into the existing settings blob, and the same mode is restored on the next launch

#### Scenario: Malformed keep-awake preference falls back to never
- **WHEN** the persisted `keepAwake` slice is missing, not an object, or carries an unknown mode
- **THEN** the preference resolves to `never`

#### Scenario: Keep-awake is configurable from Settings
- **WHEN** the user opens Settings
- **THEN** a **Keep computer awake** control offers Never / While any agent is running / While the app is open and reflects the current mode

### Requirement: Keep-awake resolves from mode and agent activity

The application SHALL resolve a single "hold the sleep inhibitor" boolean from the preference and the live roster: `never` → never held; `app-open` → held for the whole time the app is running; `agent-running` → held exactly while at least one live, non-paused, non-archived agent reads **In flight** (`working`). The backend SHALL be asked to acquire or release the inhibitor only when that boolean changes.

#### Scenario: Never mode never holds the inhibitor
- **WHEN** the mode is `never`
- **THEN** the inhibitor is not held regardless of agent activity

#### Scenario: App-open mode holds the inhibitor while the app runs
- **WHEN** the mode is `app-open`
- **THEN** the inhibitor is held even when no agent is working

#### Scenario: Agent-running mode holds the inhibitor only while an agent is In flight
- **WHEN** the mode is `agent-running` and at least one live agent is `working`
- **THEN** the inhibitor is held
- **AND** when no live agent is `working` (all waiting, finished, paused, or archived) the inhibitor is released

#### Scenario: Inhibitor toggles only on transitions
- **WHEN** the resolved boolean is unchanged across consecutive roster ticks
- **THEN** no acquire/release request is sent to the backend

### Requirement: Platform sleep inhibitor is best-effort and never outlives the app

The backend SHALL expose an idempotent acquire/release of a system idle-sleep inhibitor (`caffeinate -i -s -w <pid>` on macOS, `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` on Windows, `systemd-inhibit` on Linux when present, otherwise a no-op). Acquiring an already-held inhibitor or releasing an unheld one SHALL be a no-op. Failure to acquire SHALL be logged and SHALL NOT surface as an error to the UI. The inhibitor SHALL be released when the app window closes and SHALL NOT outlive the app process.

#### Scenario: Acquire and release are idempotent
- **WHEN** acquire is requested twice, then release is requested twice
- **THEN** exactly one platform acquire and one platform release occur

#### Scenario: Inhibitor is released when the app closes
- **WHEN** the app window receives a close request while the inhibitor is held
- **THEN** the inhibitor is released before the process exits
