## Why

Agent Desktop does not ship a Windows build. The release matrix already has a
`windows-2022` / `x86_64-pc-windows-msvc` leg with sidecars, MSVC cmake, and
NSIS/MSI bundling wired up — but it is marked `continue-on-error` because
`src-tauri` does not compile for Windows: `events.rs` and `orchestration.rs` bind
Unix-domain sockets, which do not exist there. Every release therefore publishes
macOS and Linux installers and silently drops Windows.

Fixing only the sockets is not enough. A second class of code compiles cleanly on
Windows but leaves the app unusable:

| Location | Effect on Windows |
| --- | --- |
| `src/lib/layout/persistence.ts`, `workspace.svelte.ts` | every shell pane spawns `/bin/zsh` → dead pane |
| `src-tauri/src/shell_path.rs` | colon-joined `PATH`, `$SHELL -ilc` probe, `/opt/homebrew` → `claude` is not found |
| `src/lib/usage/spawn.ts` | hook command is a bare `.cjs` path relying on a shebang + `chmod 0755` → **no hook ever fires**, so the event pipeline and all agent status derivation are dead |
| `src-tauri/src/lib.rs`, `pr.rs`, `claude_title.rs` | `HOME` is unset on Windows (it is `USERPROFILE`) |

So the goal is not "make it compile" but "ship a Windows installer that works".

## What Changes

- **Cross-platform IPC transport.** Replace both `UnixListener`s with the
  `interprocess` crate's blocking `LocalSocketListener`. The accept loops,
  threading model, `EventState` and `PendingRegistry` internals are unchanged —
  only the bind call and the name type differ. On Unix the socket paths stay
  exactly as they are today; on Windows the same env vars
  (`AGENT_DESKTOP_SOCKET_PATH`, `AGENT_DESKTOP_CONTROL_SOCKET`) carry a
  `\\.\pipe\…` name, so both Node clients keep using
  `net.createConnection({ path })` unchanged.
- **Platform-correct child process environment.** `shell_path.rs` gains a Windows
  branch (`;` separator, `USERPROFILE`, no login-shell probe, Windows well-known
  bin dirs). `HOME` reads fall back to `USERPROFILE`.
- **Hooks invoked via `node`.** `spawn.ts` emits `node "<path>"` as the hook and
  statusLine command on every platform, dropping the shebang + `chmod`
  dependency. This matches what the MCP adapter already does.
- **NEW: user-selectable shell.** The program a new pane launches becomes a
  durable, user-visible preference in the settings modal, replacing the four
  hardcoded `/bin/zsh` literals. The default is platform-derived: `pwsh` when
  present, else `powershell.exe` on Windows; `$SHELL` else `/bin/zsh` on Unix.
- **Windows becomes a required release target.** Remove `continue-on-error` from
  the Windows matrix leg so a Windows break blocks the release instead of
  silently dropping the artifact. WebView2 is bundled via Tauri's default
  download bootstrapper.

## Capabilities

### New Capabilities
- `shell-selection`: The program launched in a new terminal/shell pane is a
  durable user preference with a platform-appropriate default, selectable from
  the settings modal, rather than a hardcoded `/bin/zsh`.

### Modified Capabilities
- `activity-events`: the event hook's delivery transport is a cross-platform
  local socket rather than specifically a Unix-domain socket.
- `agent-orchestration-runtime`: same transport change for the control socket.
- `terminal-core`: a spawned pane's default program and seeded `PATH`/`HOME`
  environment are platform-correct on Windows.
- `release-pipeline`: Windows is a required, release-blocking target rather than
  a best-effort one.

## Impact

- **Dependencies:** add `interprocess` (Rust). No new JS dependencies.
- **Backend:** `src-tauri/src/events.rs`, `orchestration.rs`, `shell_path.rs`,
  `lib.rs`, `pr.rs`, `claude_title.rs`; a new `default_shell` Tauri command.
- **Frontend:** `src/lib/layout/persistence.ts`, `workspace.svelte.ts`,
  `src/lib/usage/spawn.ts`, `src/lib/ui/SettingsModal.svelte`, and the durable
  settings slice.
- **CI:** `.github/workflows/release.yml` — drop `continue-on-error`, add a fast
  Windows `cargo check` gate.
- **Not verifiable in-session:** no Windows machine is available here. Local
  `cargo check --target x86_64-pc-windows-msvc` (via `cargo-xwin`) and the CI
  Windows leg prove it *compiles and bundles*; confirming it *runs* requires
  someone to launch the artifact on real Windows. That validation is an explicit,
  unchecked task.
