## ADDED Requirements

### Requirement: A spawned pane's seeded environment is platform-correct

The `PATH` and home-directory values seeded into a pane's child process SHALL be
computed using the conventions of the host platform, so that `claude`, `gh`, and
the user's shell are discoverable on every supported OS.

Specifically, the resolver SHALL:

- join and split `PATH` entries with the platform's separator — `:` on macOS and
  Linux, `;` on Windows;
- resolve the user's home directory from `HOME` on macOS and Linux and from
  `USERPROFILE` on Windows;
- probe the user's login shell for its `PATH` ONLY on macOS and Linux; on Windows
  no login-shell probe SHALL be attempted;
- union in a well-known bin-directory safety net appropriate to the platform,
  rather than the macOS/Homebrew directories on all platforms.

#### Scenario: PATH is usable on Windows

- **WHEN** a pane spawns a child process on Windows
- **THEN** the seeded `PATH` is semicolon-separated and includes the Windows
  well-known locations where `claude` and `node` are installed
- **AND** it contains no Unix-only directories such as `/opt/homebrew/bin`

#### Scenario: macOS PATH resolution is unchanged

- **WHEN** a pane spawns a child process on macOS from a sparse GUI environment
- **THEN** the login shell is probed and the resulting `PATH` is unioned with the
  process `PATH` and the well-known Unix directories, exactly as before this
  change, so `claude` in `~/.local/bin` remains discoverable

#### Scenario: Home directory resolves on Windows

- **WHEN** code that seeds or forwards the child's home directory runs on Windows
- **THEN** the value is taken from `USERPROFILE`
- **AND** a child process that depends on it (such as the `claude` CLI) receives a
  valid home directory rather than an empty one
