# Kill a terminal pane's whole process tree on close

## Why

Trashing or stopping a terminal pane only sent SIGHUP to the pane's direct
child (portable-pty's `ChildKiller::kill`). Anything that child had spawned
which ignores hangup — `nohup`'d jobs, dev servers, an agent's tool
subprocesses running in their own process group — and any child that trapped
HUP itself survived the pane, leaking CPU, ports, and the PTY slave (which also
stranded the read loop, since EOF never arrived).

## What Changes

- `PtyManager::kill` and `kill_all` terminate the **entire process tree**
  rooted at the pane's child: SIGHUP to the leader, SIGTERM to every
  descendant and the process group, a short grace period, then SIGKILL for
  whatever is still alive (re-walking the tree so late-spawned children are
  caught). Windows uses `taskkill /T /F`.
- Single-pane close escalates on a detached thread (the IPC command still
  returns immediately); app quit escalates synchronously and in parallel
  across panes so `CloseRequested` pays one grace period.
- `portable-pty`'s killer remains only as a fallback when no pid is known.

## Capabilities

- `terminal-core` (MODIFIED)
