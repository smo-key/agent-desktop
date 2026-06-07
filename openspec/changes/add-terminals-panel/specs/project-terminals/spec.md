## ADDED Requirements

### Requirement: Per-project terminal collections

The system SHALL maintain an independent collection of user terminals for each project, keyed by project id. A terminal SHALL belong to exactly one project. Terminals in one project's collection SHALL NOT appear in another project's collection.

#### Scenario: Terminal added to one project only

- **WHEN** the user creates a terminal while project `web-app` is active
- **THEN** the terminal is added to `web-app`'s collection and does not appear in any other project's collection

#### Scenario: Each project keeps its own collection

- **WHEN** project `web-app` has two terminals and project `api` has one
- **THEN** the two collections are tracked independently and neither affects the other

### Requirement: Create a terminal

The system SHALL allow the user to create a new terminal in the active project with a single action (no command prompt): creating a terminal SHALL immediately open an empty interactive shell, with a working directory defaulting to the project's path. A created terminal SHALL be added to the active project's collection as a durable entry and SHALL start running immediately. The underlying model MAY also carry an explicit command (used by restore), but the create action SHALL default to an empty shell.

#### Scenario: Create a shell terminal

- **WHEN** the user creates a terminal without specifying a command
- **THEN** a new terminal entry is added running the default shell with the project's path as its working directory

#### Scenario: Create a terminal with a command

- **WHEN** the user creates a terminal specifying a command (e.g. `npm run dev`)
- **THEN** a new terminal entry is added that runs that command, with the project's path as its working directory unless another directory is specified

#### Scenario: A created shell terminal is named after the shell

- **WHEN** the user creates an empty shell terminal
- **THEN** the terminal's default name is the shell's basename (e.g. `zsh`)

### Requirement: Terminal title tracks the running command

A terminal's displayed name SHALL reflect the actively running command when the terminal reports a title (an OSC 0/2 title escape, surfaced by the terminal emulator). When no title has been reported, the displayed name SHALL fall back to the persisted name (the shell basename, the configured command, or a user rename). A user rename SHALL be honored as an explicit override.

#### Scenario: Terminal title reflects the running command

- **WHEN** a terminal reports a title (the running command)
- **THEN** the terminal's displayed name shows that command rather than the shell name

#### Scenario: Falls back to the shell name with no reported title

- **WHEN** a shell terminal has reported no title
- **THEN** the terminal's displayed name is the shell basename (e.g. `zsh`)

### Requirement: Terminal lifecycle — start, stop, restart

Each terminal SHALL be a durable slot whose process may be running or stopped. The system SHALL allow the user to start a stopped terminal, stop a running terminal (terminating and reaping its process), and restart a terminal (stopping it if running, then starting it again with the same command and working directory). Stopping a terminal SHALL NOT remove its entry from the collection.

#### Scenario: Start a stopped terminal

- **WHEN** the user starts a stopped terminal
- **THEN** its process is spawned with the terminal's command and working directory and the terminal is marked running

#### Scenario: Stop a running terminal

- **WHEN** the user stops a running terminal
- **THEN** its process is terminated and reaped, the terminal is marked stopped, and the entry remains in the collection

#### Scenario: Restart a terminal

- **WHEN** the user restarts a running terminal
- **THEN** its current process is stopped and reaped and a new process is started with the same command and working directory

#### Scenario: Process exiting on its own marks the terminal stopped

- **WHEN** a terminal's process exits by itself (success or failure)
- **THEN** the terminal is marked stopped and shows its exit code, and the entry is not removed from the collection

### Requirement: Rename a terminal

The system SHALL allow the user to assign and change a human-readable name for each terminal. A new terminal SHALL receive a default name derived from its command (or the shell). The name SHALL be displayed in the panel and SHALL persist with the terminal.

#### Scenario: Default name on creation

- **WHEN** a terminal is created running `npm run dev`
- **THEN** it receives a default name derived from that command

#### Scenario: Rename persists

- **WHEN** the user renames a terminal to `dev server`
- **THEN** the panel shows `dev server` and the name is retained across app restarts

### Requirement: Persisted terminal definitions

The system SHALL persist each project's terminal definitions — id, name, command, and working directory — across app restarts, in a versioned store separate from the workspace layout. Runtime-only state (the live process handle, current running/stopped status, exit code) SHALL NOT be serialized. Persistence SHALL use an atomic write and SHALL fall back to an empty collection on a missing or unparseable store rather than failing.

#### Scenario: Definitions restored on restart

- **WHEN** the app restarts after the user defined terminals in several projects
- **THEN** each project's terminal definitions (name, command, working directory) are restored into their respective collections

#### Scenario: Corrupt or missing store loads empty

- **WHEN** the terminals store file is missing or cannot be parsed
- **THEN** the system loads an empty set of collections and does not error

#### Scenario: Runtime state is not persisted

- **WHEN** terminal definitions are saved
- **THEN** the saved data excludes live process handles, current running status, and exit codes

### Requirement: Selective auto-restart on launch

On app launch the system SHALL auto-start only the terminals that were running at the time of the previous graceful quit, restoring all other terminals as stopped. The system SHALL capture each terminal's running state at quit and SHALL NOT re-run a terminal's command on launch unless that terminal was running when the app quit. For a terminal that was running, the system SHALL also capture the actively-running command (from the live terminal title) at quit and SHALL re-run that command in the restored shell, so a restored terminal returns to what it was doing; if no command was captured, it SHALL restore as a plain interactive shell.

#### Scenario: Running command captured at quit

- **WHEN** the app quits gracefully while a terminal is running a command (reported via its live title)
- **THEN** that command is persisted as the terminal's last-running command, and is cleared for terminals that were not running

#### Scenario: Restored terminal re-runs its last running command

- **WHEN** a terminal that was running a captured command is auto-restarted on the next launch
- **THEN** the restored shell re-runs that command (it is delivered as the shell's initial input)

#### Scenario: Previously running terminal auto-restarts

- **WHEN** a terminal was running at the time the app quit
- **THEN** on the next launch that terminal is automatically started with its persisted command and working directory

#### Scenario: Previously stopped terminal stays stopped

- **WHEN** a terminal was stopped at the time the app quit
- **THEN** on the next launch that terminal is restored as a stopped entry and its command is not run until the user starts it

#### Scenario: Running state captured at quit

- **WHEN** the app quits gracefully
- **THEN** the running/stopped state of each terminal is persisted so the next launch can selectively auto-restart

### Requirement: No orphaned terminal processes on quit

On app quit the system SHALL terminate and reap every running terminal process so that no zombie or orphan processes remain, independent of whether the panel was visible.

#### Scenario: All terminal processes reaped on quit

- **WHEN** the app quits while one or more terminals are running
- **THEN** every running terminal process is terminated and reaped before the app exits
