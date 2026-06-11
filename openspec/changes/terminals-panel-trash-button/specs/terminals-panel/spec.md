## ADDED Requirements

### Requirement: Always-on kill-and-close button per terminal

Each terminal slot in the panel SHALL render, in its header, a single trash
button that is ALWAYS present — for both terminal-task slots and bare
interactive shells, and regardless of whether the terminal is running or
stopped. Activating the button SHALL kill the terminal's process if it is still
running AND close (remove) that slot from the panel in one action: the entry is
dropped from the running surface, which unmounts its terminal pane so its
teardown kills and reaps any live PTY. Dropping a terminal-task slot SHALL leave
its task definition in the launcher; dropping a bare shell SHALL remove it
entirely. The button's accessible label SHALL reflect the slot's state — "Kill
terminal" while running and "Close terminal" once stopped.

#### Scenario: Trash button is shown on a running terminal

- **WHEN** a terminal in the panel is running
- **THEN** its header shows a trash button labelled "Kill terminal"

#### Scenario: Trash button is shown on a stopped terminal

- **WHEN** a terminal in the panel has stopped (a failed task, a kept-open clean exit, or a stopped bare shell)
- **THEN** its header shows a trash button labelled "Close terminal"

#### Scenario: Clicking kills and closes a running task

- **WHEN** the user clicks the trash button of a running terminal-task slot
- **THEN** its process is killed, its slot is removed from the panel, and its task definition remains in the launcher

#### Scenario: Clicking kills and closes a running bare shell

- **WHEN** the user clicks the trash button of a running bare interactive shell
- **THEN** its process is killed and its slot is removed from the panel entirely
