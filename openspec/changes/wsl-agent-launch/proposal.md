## Why

A Windows user configured their shell as
`C:\Program Files\WindowsApps\…\ubuntu.exe` — a WSL distro launcher — opened a
project living at `\\wsl.localhost\Ubuntu\home\v-patel\source\data-flow-central`,
and every agent session failed to start:

```
failed to start claude: spawn_command failed: CreateProcessW `"claude" …`
  in cwd `Some("\\wsl.localhost\Ubuntu\home\v-patel\source\data-flow-central")`
  failed: The system cannot find the file specified. (os error 2)
```

`os error 2` is `ERROR_FILE_NOT_FOUND` on the **image**, not the working
directory (a bad directory yields error 3). The diagnosis is therefore exact:
`claude` is installed inside the distro, on the Linux `PATH`, and is not a
Windows executable that `CreateProcessW` can find.

The `shell-selection` capability made the *shell* pane configurable, but agent
panes never got the same treatment. `agent-backends` hardcodes `program: 'claude'`
as both the backend identity and the executable name, so an agent pane always
tries to spawn a Windows image called `claude`. There is no setting that can fix
this, and no amount of `PATH` seeding on the Windows side can either — the
executable simply does not exist on that side of the VM boundary.

The literal ask — "detect the executable in WSL" — carries a consequence worth
stating up front: a detected path like `/home/v-patel/.local/bin/claude` is a
**Linux** path, and cannot be handed to `CreateProcessW` any more than the bare
name could. Honoring the requirement means the launch itself becomes a
WSL-wrapped invocation with a translated working directory. A settings field
holding a path, on its own, does not make this error go away.

## What Changes

- **NEW: WSL-aware agent launch.** When the configured shell is a WSL distro
  launcher, an agent pane is spawned as
  `wsl.exe [-d <distro>] -- sh -lc 'cd … && exec …'` rather than as a bare
  Windows image. The login shell (`-lc`) is what puts `~/.local/bin` on `PATH`
  inside the distro — the same problem `shell_path.rs` already solves on macOS
  with `$SHELL -ilc`. Windows paths are translated for the Linux side
  (`\\wsl.localhost\<distro>\…` → `/…`, `C:\Users\X` → `/mnt/c/Users/X`).
- **NEW: per-backend executable detection.** A backend command probes for each
  agent CLI in the place the configured shell implies — inside the distro for a
  WSL shell, on the host `PATH` otherwise. The result is advisory: it fills the
  settings placeholder and supplies the default, and a failed probe never blocks
  a launch.
- **NEW: per-backend executable preference.** The path used for each agent CLI
  becomes a durable `settings.json` preference with one input per backend in the
  settings modal, mirroring the existing shell field: empty means "use the
  detected value", which is shown as the input's placeholder.
- **MODIFIED: capabilities become a function of launch context.** A WSL-launched
  claude pane declares `hooks: false`, because the event hook delivers over
  `AGENT_DESKTOP_SOCKET_PATH` — a `\\.\pipe\…` name a process inside the distro
  cannot reach. Per the `agent-backends` degradation mechanism (design D1), the
  surfaces gated on that flag are OMITTED rather than rendered dead. The
  `statusLine` pipeline is KEPT WHERE IT CAN RUN: it writes a *file* into
  `AGENT_DESKTOP_SNAPSHOT_DIR`, reachable from inside the distro as `/mnt/c/…`
  once translated — but it is invoked as `node "<path>"`, so it is retained only
  when `node` is present INSIDE the distro. On the reporting user's machine it is
  not (the agent CLIs are self-contained binaries), so their WSL panes get
  neither pipeline.
- **MODIFIED: the pane's `program` stays the backend kind.** `backendForProgram`
  is a literal `=== 'claude'` comparison that layout persistence, status
  derivation, subagent rows and `isAgentProgram` all key on. The resolved
  executable and the WSL wrapper are applied at the spawn seam
  (`buildSpawnOverride`, called immediately before `pty_spawn`), never written
  back into the pane's identity.

## Capabilities

### New Capabilities
- `wsl-agent-launch`: An agent session whose shell is a WSL distro launcher is
  launched inside that distro, with its working directory and the app-managed
  script paths translated across the VM boundary, and with the executable for
  each agent CLI detected inside the distro and overridable by the user.

### Modified Capabilities
- `shell-selection`: the configured shell gains a second role — it is the signal
  that determines WHERE agent executables are detected, so changing it
  invalidates the detected values.
- `agent-backends`: a backend's declared capabilities become a function of the
  launch context, not the kind alone.

## Known limitations

Recorded deliberately, so the change is not mistaken for full WSL support. Each
is a real gap that this change does NOT close:

- **The event socket does not cross the VM boundary.** `AGENT_DESKTOP_SOCKET_PATH`
  is a Windows named pipe; a Linux process cannot open it with
  `net.createConnection({ path })`. WSL panes therefore produce no lifecycle
  events, so the event-sourced status and per-tool timeline stay dark for them.
  Closing this needs a second, WSL-reachable transport in `events.rs` and
  `orchestration.rs` — a separate change.
- **The transcript root is on the wrong side.** The overview polls
  `~/.claude/projects/…` for the last message, pending question and context %.
  Under WSL that directory is in the Linux home, not `C:\Users\…\.claude`, so
  transcript-derived activity is unavailable for WSL panes. It is reachable in
  principle via `\\wsl.localhost\<distro>\home\…`, which is why this is a gap
  rather than an impossibility.
- **Teardown does not reach into the VM.** Under `wsl.exe` the direct child is
  the relay process, so `process_tree::terminate` on its pid cannot see the
  Linux-side descendants. A closed WSL pane may leave a straggler inside the
  distro.

## Success criteria

A user whose shell is a WSL distro launcher, opening a project under
`\\wsl.localhost\<distro>\…`, gets a working agent session instead of
`os error 2` — and can correct a mis-detected executable from the settings modal
without editing a file.

This change does NOT claim WSL is fully supported, and the gap is wider than
"some surfaces degrade". On the reporting user's machine, where the distro has no
`node`, a WSL pane has NO observability: it launches and is fully usable as a
session, but its overview row shows no status, no last message, no context % and
no tool timeline. The honest summary of what ships here is **"WSL launches"**,
not "WSL works". The limitations above bound that claim, and `design.md` D5
records a concrete avenue (WSL binfmt interop, invoking `node.exe` so the hook
runs as a Windows process able to reach the named pipe) for closing it in a
follow-up.
