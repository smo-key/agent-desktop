## Context

`src-tauri` does not compile for `x86_64-pc-windows-msvc`. A local type-check
(see "Local verification" below) confirms the failure is **exactly three errors**,
all `cannot find 'unix' in 'os'`:

```
src/events.rs:22          use std::os::unix::net::UnixListener;
src/orchestration.rs:30   use std::os::unix::net::UnixListener;
src/orchestration.rs:331  stream: std::os::unix::net::UnixStream,
```

Nothing else in ~14.5k lines of Rust fails to compile. The `PermissionsExt` uses
in `lib.rs`/`git.rs` are already `#[cfg(unix)]`-gated and the macOS-only crates
(`objc2`, `mac-notification-sys`) already sit under
`[target.'cfg(target_os = "macos")'.dependencies]`.

The larger risk is the code that **compiles but misbehaves** on Windows — the
hardcoded `/bin/zsh` defaults, Unix `PATH`/`HOME` handling, and shebang-dependent
hook invocation. A compile-only fix would ship an installer that launches and then
does nothing useful.

## Goals / Non-Goals

**Goals**
- `src-tauri` compiles for `x86_64-pc-windows-msvc`.
- The event pipeline and orchestration control plane work on Windows.
- Shell panes launch a usable shell on Windows, user-selectable.
- Windows is a required release target producing a published installer.

**Non-Goals**
- Windows on ARM (`aarch64-pc-windows-msvc`). The sidecar toolchain and runner
  matrix target x64 only.
- Code-signing the Windows installer. The artifact will trigger SmartScreen; that
  is a separate concern with its own certificate procurement.
- Verifying runtime behavior on real Windows hardware — see "Risks".

## Decisions

### D1. `interprocess` for the IPC transport

Chosen over the alternatives:

| Option | Why not |
| --- | --- |
| Loopback TCP + token | Exposes `spawn_agent`/`message_agent` to every local process; security would rest on a hand-rolled handshake. |
| `#[cfg]` split with tokio named pipes | tokio's named pipes are async while these accept loops are blocking `std::thread`; Windows would need a runtime and a second accept loop, doubling the code and test surface permanently. |

`interprocess` exposes a **blocking** `LocalSocketListener`/`Stream` that maps to
UDS on Unix and named pipes on Windows. The accept-loop bodies, `EventState`,
`PendingRegistry`, per-target serialization and timeout logic are untouched; only
the bind call and name construction change.

### D2. The socket address stays opaque to clients

Both Node clients use `net.createConnection({ path })`, which Node already
routes to a named pipe when the string looks like `\\.\pipe\…`. So the existing
env vars (`AGENT_DESKTOP_SOCKET_PATH`, `AGENT_DESKTOP_CONTROL_SOCKET`) simply
carry a different *kind* of address on Windows and **neither `.cjs` file needs a
platform branch**. This keeps the hook contract stable.

### D3. Pipe names are process-scoped

On Unix, a stale socket file from a crashed run makes `bind()` fail with
`AddrInUse`, which the current code handles by `remove_file` first
(`events.rs:259`). Named pipes have no filesystem entry to unlink and that trick
has no Windows equivalent.

Instead the Windows pipe name is suffixed with the app's process id
(`\\.\pipe\agent-desktop-events-<pid>`), so a new instance never collides with a
dying one. The address is only ever discovered through the env var, so the
dynamic name costs nothing. Unix keeps the existing fixed path + unlink behavior.

### D4. Hooks are invoked as `node "<path>"` on every platform

Windows honors neither the `#!` shebang nor the executable bit, so the current
bare-path hook command would never fire — silently disabling all agent status
derivation.

Rather than branch, `spawn.ts` emits `node "<path>"` everywhere. This is what the
MCP adapter already does (`lib.rs:123`), and it is not a functional regression on
Unix: the existing shebang is `#!/usr/bin/env node`, so `node` had to be on `PATH`
regardless. The `#[cfg(unix)]` chmod stays — harmless, and keeps the scripts
directly runnable for debugging.

### D5. Shell resolution belongs in the backend

The frontend cannot inspect `PATH` to tell whether `pwsh` exists, and
`workspace.svelte.ts:184` already reaches for `process.env.SHELL` defensively from
a WebView where `process` is usually undefined. So a `default_shell` Tauri command
resolves the platform default once, and the four hardcoded `/bin/zsh` literals
collapse into one resolver that prefers the stored preference and falls back to
that value.

### D6. Windows becomes release-blocking

Making the leg required is the point of the change: `continue-on-error` is what
let Windows rot to non-compiling without anyone noticing. A fast `cargo check`
gate catches regressions in ~2 minutes rather than at bundle time.

## Local verification

Windows type-checking runs on macOS, which makes the port iterable in seconds
instead of a ~10-minute CI round trip. Two non-obvious prerequisites:

1. **Homebrew's `rust` formula owns `/opt/homebrew/bin/rustc`** and its sysroot has
   no Windows std, so a bare `cargo check --target x86_64-pc-windows-msvc` fails
   with `can't find crate for core` even when rustup has the target installed. The
   rustup toolchain's `bin` must come first on `PATH` with `RUSTC` pinned to it.
2. **`ring` compiles C for the target** and needs the MSVC CRT headers, which
   macOS lacks. `cargo xwin check` supplies them.

`tauri-build` additionally rejects the build unless the Windows sidecars exist, so
local checks need stub files at `src-tauri/binaries/*-x86_64-pc-windows-msvc.exe`
(that directory is gitignored, so the stubs never get committed).

## Risks / Trade-offs

- **No Windows hardware in the loop.** Compilation and bundling can be proven;
  runtime behavior cannot. Everything in this change is verified by
  `cargo check`, unit tests, and CI bundling — the first real launch is a manual
  step, tracked as an explicit unchecked task.
- **Making Windows required can block releases.** Accepted deliberately (D6); the
  `cargo check` gate exists to make that failure mode rare and early.
- **`interprocess` is a new dependency** in the trusted path of both IPC servers.
  Mitigated by it being a widely used crate and by the transport being the only
  thing delegated to it — framing, parsing and dispatch stay in our code.
- **Named-pipe semantics differ subtly from UDS** (no filesystem permissions;
  default ACL grants the creating user). For a per-user desktop app this is
  equivalent in practice to a socket file in the app-data dir.
