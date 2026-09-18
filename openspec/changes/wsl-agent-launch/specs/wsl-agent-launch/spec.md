## ADDED Requirements

### Requirement: An agent session launches inside the distro when the shell is a WSL launcher
The system SHALL launch an agent pane inside the WSL distro, rather than as a bare Windows image, whenever the configured shell is a WSL distro launcher.

The invocation SHALL run the agent executable through a LOGIN shell inside the
distro, so that `PATH` entries contributed by the user's login profile — notably
`~/.local/bin`, where the agent CLIs are commonly installed — are present. The
working directory SHALL be applied inside the distro as a translated Linux path.

Arguments SHALL be passed as arguments, never interpolated into shell script
text, so a path or prompt containing whitespace or quote characters cannot alter
the command.

Shell panes SHALL continue to launch exactly the program the user configured;
this requirement changes agent panes only.

#### Scenario: Agent session in a WSL project folder

- **WHEN** the configured shell is a WSL distro launcher and a session is
  launched in a folder inside the distro
- **THEN** the agent process starts and presents a working session
- **AND** the session's working directory is the chosen folder as seen from
  inside the distro

#### Scenario: A launch with no working directory is refused

- **WHEN** a WSL launch is attempted with no working directory
- **THEN** the launch fails rather than silently starting the agent in an
  arbitrary default directory

#### Scenario: The agent CLI is only on the login PATH

- **WHEN** the agent executable is installed at a location that only the distro's
  login profile adds to `PATH`
- **THEN** the executable still resolves and the session starts

#### Scenario: A path containing spaces

- **WHEN** the chosen folder or an injected argument contains spaces or quote
  characters
- **THEN** the value reaches the agent process intact and is not split or
  reinterpreted as shell syntax

#### Scenario: A non-WSL shell is unaffected

- **WHEN** the configured shell is not a WSL distro launcher
- **THEN** the agent pane is spawned exactly as it is today, with no WSL wrapper

### Requirement: Paths are translated across the VM boundary
The system SHALL translate Windows paths to their Linux equivalents when they are passed to a process running inside the distro.

Translation SHALL cover the working directory and any app-managed script or
directory path included in the session's launch configuration. Both the current
`\\wsl.localhost\<distro>\…` and the legacy `\\wsl$\<distro>\…` forms of a
distro-internal path SHALL be recognized. A path that is already POSIX-style
SHALL be passed through unchanged.

#### Scenario: A distro-internal project folder

- **WHEN** the working directory is `\\wsl.localhost\Ubuntu\home\u\src\app`
- **THEN** the process inside the distro sees `/home/u/src/app`

#### Scenario: The legacy UNC form

- **WHEN** the working directory uses the older `\\wsl$\Ubuntu\…` form
- **THEN** it is translated identically to the current form

#### Scenario: A Windows-drive path

- **WHEN** an app-managed script lives at `C:\Users\u\AppData\Roaming\app\s.js`
- **THEN** the process inside the distro is given `/mnt/c/Users/u/AppData/Roaming/app/s.js`

### Requirement: The distro is identified from the strongest available signal
The system SHALL identify the target distro from the working directory when it is a distro-internal path, since such a path names its distro unambiguously.

When the working directory does not name a distro, the shell launcher's name
SHALL be used. When neither identifies a distro, the system SHALL NOT guess: it
SHALL launch without naming a distro, so the user's default distro applies.

#### Scenario: The folder names the distro

- **WHEN** the folder is under `\\wsl.localhost\Debian\…` while the configured
  shell is a different distro's launcher
- **THEN** the session is launched in `Debian`

#### Scenario: Only the shell names the distro

- **WHEN** the folder is not a distro-internal path and the shell is a
  distro-specific launcher
- **THEN** that distro is used

#### Scenario: Neither names a distro

- **WHEN** the shell is a generic WSL launcher and the folder is not
  distro-internal
- **THEN** the session is launched without naming a distro, and the user's
  default distro applies

### Requirement: Each agent executable is detected where the configured shell implies
The system SHALL detect the executable for each supported agent CLI in the location the configured shell implies — inside the distro for a WSL shell, and on the host otherwise.

Detection SHALL be advisory: it supplies the value used when the user has
expressed no preference, and the value shown to the user as the detected default.
A detection that fails, times out, or finds nothing SHALL NOT block a launch and
SHALL NOT surface an error; the system falls back to the behavior it has when no
executable is detected.

Detection SHALL be bounded in time, because probing inside a distro that is not
running requires starting it.

#### Scenario: Detection inside the distro

- **WHEN** the configured shell is a WSL distro launcher and an agent CLI is
  installed inside that distro
- **THEN** the detected executable is that CLI's path as seen from inside the
  distro

#### Scenario: Detection finds nothing

- **WHEN** an agent CLI is not installed in the probed location
- **THEN** no executable is detected for that agent, no error is surfaced, and
  launching remains possible

#### Scenario: The probe does not return

- **WHEN** the probe cannot complete within its time bound
- **THEN** detection yields no result and the application remains responsive

### Requirement: The executable for each agent is a durable user preference
The executable used for each agent CLI SHALL be a user preference persisted in the durable settings file, and SHALL NOT be stored in `localStorage`.

An unset preference SHALL mean "use the detected executable". The settings modal
SHALL expose one control per supported agent, and SHALL show the currently
detected executable as the control's placeholder, so the user can see what they
would get before choosing.

A stored preference SHALL take effect for agent sessions launched afterwards, on
EVERY platform — not only for sessions launched inside a distro. A control that
is offered everywhere but honoured only in one launch context would silently
discard what the user typed.

A detected executable SHALL be used only when the location it was detected in is
the location the session will run in. Where a launch targets a different distro
than detection probed, the detected path SHALL be disregarded in favour of the
plain program name; an explicit user preference is never disregarded.

#### Scenario: Correcting a mis-detected executable

- **WHEN** the user enters an explicit path for an agent and launches a session
- **THEN** that path is used instead of the detected one
- **AND** this holds on every platform, including when no distro is involved

#### Scenario: A launch targets a different distro than detection probed

- **WHEN** the configured shell names one distro but the session's folder is
  inside another
- **THEN** the executable detected in the first distro is not used for that
  launch
- **AND** the session launches with the plain program name instead

#### Scenario: The detected value is visible when unset

- **WHEN** the user opens settings without having set an executable for an agent
- **THEN** the control communicates which executable is currently in effect

#### Scenario: Clearing the preference

- **WHEN** the user clears a previously set executable
- **THEN** the detected executable applies again

#### Scenario: Executable preference survives a restart

- **WHEN** the user sets an executable and the application later restarts
- **THEN** agent sessions launch the chosen executable

### Requirement: Observability degrades honestly for a WSL-launched session
The system SHALL NOT configure an observability pipeline that cannot function across the VM boundary, and SHALL instead declare the affected capability unsupported for that session.

Every such pipeline the system ADDRESSES THROUGH THE ENVIRONMENT — passing a
destination to the agent as an environment variable — SHALL be omitted from a
WSL-launched session, because host environment variables are not propagated into
a distro unless explicitly exported for it, and a pipeline whose destination
never arrives produces nothing while still costing a process per invocation.

This holds regardless of whether the destination itself would be reachable: a
file-writing pipeline whose directory IS reachable from inside the distro is
still omitted, because the session is never told where that directory is.

Settings that govern correctness rather than observability SHALL be applied
unconditionally.

#### Scenario: Socket-delivered events are omitted, not broken

- **WHEN** an agent session is launched inside a distro
- **THEN** the session is not configured with hooks that deliver over a
  host-local socket
- **AND** the surfaces gated on that capability are omitted from the pane rather
  than rendered empty or in error

#### Scenario: Env-addressed pipelines are omitted, not broken

- **WHEN** an agent session is launched inside a distro
- **THEN** no pipeline whose destination is communicated through the environment
  is configured, including one that writes to an otherwise-reachable file
- **AND** the destination values are not passed to the session at all
- **AND** the session still launches

#### Scenario: Correctness settings are unconditional

- **WHEN** an agent session is launched inside a distro
- **THEN** the settings that keep the session local and disable the built-in
  agent view are applied exactly as for a non-WSL session

### Requirement: A pane's recorded program remains the agent kind
The system SHALL continue to record a launched agent pane's program as the agent kind, and SHALL apply the resolved executable and any WSL wrapper only when spawning.

The recorded program is what identifies a pane as an agent pane across layout
persistence, status derivation and related surfaces; replacing it with a resolved
path or a wrapper executable would make those surfaces stop recognizing the pane,
silently.

#### Scenario: A WSL-launched pane is still an agent pane

- **WHEN** an agent session is launched inside a distro
- **THEN** the pane is recognized as an agent pane, with its agent-specific
  affordances, exactly as a non-WSL agent pane is

#### Scenario: A restored WSL pane

- **WHEN** a layout containing a WSL-launched agent pane is persisted and restored
- **THEN** the pane is restored as an agent pane of the same kind
