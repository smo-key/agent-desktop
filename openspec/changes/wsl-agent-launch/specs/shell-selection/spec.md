## MODIFIED Requirements

<!-- Rebased on the not-yet-archived `shell-selection` delta in
     `openspec/changes/windows-x64-support/`. The text below reproduces that
     change's version of this requirement and ADDS the detection-invalidation
     behavior; archiving either change first leaves both intact. -->

### Requirement: The shell is selectable from the settings modal
The settings modal SHALL expose the shell preference so a user can change the program new shell panes launch, without editing a file.

The control SHALL indicate the resolved platform default when no explicit
preference is set, so the user can see what they would get before choosing.

The shell preference SHALL additionally serve as the signal for WHERE agent
executables are detected: a shell that launches a WSL distro means the agent CLIs
are to be sought inside that distro rather than on the host. Changing the shell
preference SHALL therefore invalidate any previously detected agent executables
and cause detection to be performed again, so that a value detected under a
previous shell is never presented as the current one.

#### Scenario: Changing the shell from settings

- **WHEN** the user opens settings and chooses a different shell
- **THEN** the preference is persisted immediately
- **AND** shell panes created afterwards launch the newly chosen program

#### Scenario: Default is visible when unset

- **WHEN** the user opens settings without having set a shell preference
- **THEN** the control communicates which program is currently in effect by
  default on this platform

#### Scenario: Switching away from a WSL shell

- **WHEN** the user changes the shell from a WSL distro launcher to a host shell
- **THEN** the agent executables are detected again against the host
- **AND** the previously detected in-distro executables are no longer presented
  as the current detected values

#### Scenario: Switching to a WSL shell

- **WHEN** the user changes the shell to a WSL distro launcher
- **THEN** the agent executables are detected again inside that distro
