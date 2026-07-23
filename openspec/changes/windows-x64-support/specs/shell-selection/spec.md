## ADDED Requirements

### Requirement: A new shell pane launches a platform-appropriate default program

The program launched in a new terminal/shell pane SHALL be derived from the host
platform when no shell preference is stored, rather than hardcoded to a single
Unix shell.

The default SHALL be resolved as:

- **Windows** — `pwsh` when a PowerShell 7+ executable is present on `PATH`,
  otherwise `powershell.exe` (present on every Windows install).
- **macOS and Linux** — the user's `$SHELL` when set, otherwise `/bin/zsh`.

The resolution SHALL be performed by the backend, which can inspect the real
process environment and `PATH`, and exposed to the frontend as a single value; the
frontend SHALL NOT hardcode a platform default of its own.

#### Scenario: Fresh install on Windows

- **WHEN** a user opens a new shell pane on Windows with PowerShell 7 installed
  and no stored preference
- **THEN** the pane launches `pwsh` and presents a working shell

#### Scenario: Windows without PowerShell 7

- **WHEN** a user opens a new shell pane on Windows and no `pwsh` is on `PATH`
- **THEN** the pane launches `powershell.exe` rather than failing to spawn

#### Scenario: macOS default is unchanged

- **WHEN** a user opens a new shell pane on macOS with no stored preference
- **THEN** the pane launches `$SHELL`, or `/bin/zsh` when `$SHELL` is unset,
  exactly as before this change

### Requirement: The shell program is a durable user preference

The program used for new shell panes SHALL be a user preference persisted in the
durable `settings.json` slice, alongside the other remembered preferences, and
SHALL NOT be stored in `localStorage`.

When the preference is unset, the platform default above applies. When it is set,
it SHALL be used for newly created shell panes.

#### Scenario: Preference survives a restart

- **WHEN** the user selects a shell and the application later restarts
- **THEN** new shell panes launch the selected program rather than reverting to
  the platform default

#### Scenario: Unset preference falls through to the default

- **WHEN** no shell preference has ever been set, or the stored value is absent or
  malformed
- **THEN** the platform default is used without error

### Requirement: The shell is selectable from the settings modal

The settings modal SHALL expose the shell preference so a user can change the
program new shell panes launch, without editing a file.

The control SHALL indicate the resolved platform default when no explicit
preference is set, so the user can see what they would get before choosing.

#### Scenario: Changing the shell from settings

- **WHEN** the user opens settings and chooses a different shell
- **THEN** the preference is persisted immediately
- **AND** shell panes created afterwards launch the newly chosen program

#### Scenario: Default is visible when unset

- **WHEN** the user opens settings without having set a shell preference
- **THEN** the control communicates which program is currently in effect by
  default on this platform

### Requirement: A pane with an unusable stored program falls back

The system SHALL fall back to the resolved default program when a persisted pane
or workspace records a program that cannot be launched on the current platform —
for example a `/bin/zsh` entry in a layout restored on Windows — rather than
spawning a pane that immediately dies.

#### Scenario: A macOS-authored layout is restored on Windows

- **WHEN** a persisted layout recorded `/bin/zsh` as a pane's program and that
  layout is restored on Windows
- **THEN** the pane launches the resolved Windows default instead
- **AND** the restored workspace presents a usable shell rather than a dead pane
