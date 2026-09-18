## 1. Pure WSL module (TDD)

- [ ] 1.1 Create `src/lib/shell/wsl.ts` with `isWslShell(program)`: basename
  matches `wsl.exe`, `bash.exe`, or a `<distro>.exe` launcher
  (`ubuntu.exe`, `ubuntu-24.04.exe`, `debian.exe`, `kali-linux.exe`,
  `opensuse-*.exe`, `sles-*.exe`, `oracle-linux-*.exe`, `fedora*.exe`).
  Case-insensitive; tolerant of a full `C:\Program Files\WindowsApps\…` path.
- [ ] 1.2 `distroFromCwd(cwd)`: `\\wsl.localhost\<distro>\…` and legacy
  `\\wsl$\<distro>\…` → distro; anything else → `null`.
- [ ] 1.3 `distroFromShell(program)`: `ubuntu-24.04.exe` → `Ubuntu-24.04`;
  `wsl.exe` / `bash.exe` → `null` (use the default distro).
- [ ] 1.4 `distroFor(shell, cwd)`: cwd wins, then shell, then `null` (design D3).
- [ ] 1.4a `isPseudoDistro(name)`: `docker-desktop` / `docker-desktop-data` are
  never valid launch targets. VERIFIED: the reporter's `wsl.exe -l -q` lists
  `Ubuntu` and `docker-desktop`, so multi-distro is ordinary.
- [ ] 1.5 `toWslPath(p)`: UNC → `/…`; `C:\Users\X` and `C:/Users/X` →
  `/mnt/c/Users/X`; an already-POSIX path unchanged. Backslashes normalized.
- [ ] 1.6 `wslInvocation({ distro, cwd, exe, args })` → `{ program, args }`
  building
  `wsl.exe [-d D] -- sh -lc 'cd "$1" || exit 1; shift; exec "$@"' sh <cwd> <exe> <args…>`
  (design D1/D2). Arguments are passed positionally — NEVER interpolated into the
  script text. NOTE the literal `sh` placeholder: POSIX assigns the first operand
  after the script to `$0`, so omitting it would shift every parameter by one.
- [ ] 1.7 Unit tests in `src/lib/shell/wsl.test.ts`, with `it(...)` titles
  matching the `#### Scenario:` names from the `wsl-agent-launch` spec so the
  coverage gate can match them. Cover: spaces and quotes in the cwd, the legacy
  UNC form, an unrecognized launcher, and a distro-less invocation.

## 2. Backend detection (TDD)

- [ ] 2.1 Add `detect_agent_executables(shell: String)` to
  `src-tauri/src/shell_path.rs`, returning one optional path per agent kind.
- [ ] 2.2 WSL branch: run
  `wsl.exe [-d D] -- sh -lc 'command -v claude; command -v copilot; command -v node'`
  under the existing `SHELL_TIMEOUT` guard, parsing one path per line. `node` is
  probed because the statusline wrapper is invoked as `node "<path>"` and that is
  the DISTRO's node, not the Windows one — D5's retention of the statusline is
  conditional on it.
- [ ] 2.3 Non-WSL branch: probe the host `PATH` (`which`/`where`) for the same
  executables, so the placeholder is populated on every platform, not just WSL.
- [ ] 2.4 Cache the result KEYED BY THE SHELL it was probed with — NOT a
  `OnceLock` (design D6): the value changes when the shell preference changes.
- [ ] 2.5 Register the command in `lib.rs`'s invoke handler.
- [ ] 2.6 Rust unit tests for the output parsing (empty output, one of two found,
  trailing whitespace, a path containing a space) without invoking `wsl.exe`.

## 3. Settings slice and UI (TDD)

- [ ] 3.1 Create `src/lib/settings/agentPaths.svelte.ts` mirroring
  `shell.svelte.ts`: a durable `agentPaths` slice of `settings.json`, a
  `parseAgentPaths` tolerating any shape, and a store exposing both the stored
  preference and the detected value per kind.
- [ ] 3.2 `load()` calls `detect_agent_executables` with the current shell, then
  reads the persisted slice. MUST NOT reject — the layout restore in
  `+page.svelte` is chained onto the settings load.
- [ ] 3.3 Re-run detection when the shell preference changes: `ShellStore.setProgram`
  today only saves (design D6). Wire the invalidation.
- [ ] 3.4 Add the controls to `SettingsModal.svelte`, cloning the shell field at
  lines 322–332: one text input per `AGENT_KINDS` entry, `placeholder={detected}`,
  empty means "use detected". Driven off `AGENT_KINDS` so a future backend needs
  no UI edit.
- [ ] 3.5 Unit tests for `parseAgentPaths` and the resolution order
  (preference → detected → bare backend kind).

## 4. Spawn seam (TDD)

- [ ] 4.1 Extend `SpawnOverride` with `program` and `cwd`, and
  `SpawnOverrideInput` with the configured shell plus the resolved per-kind
  executable. Non-WSL callers get today's values back unchanged.
- [ ] 4.2 In `buildSpawnOverride`, when the shell is a WSL launcher and the
  program is an agent kind: resolve the executable, build the WSL invocation, and
  return the wrapper as `program` with the translated `cwd`.
- [ ] 4.3 Omit the `hooks` key from `--settings` for a WSL launch. KEEP
  `statusLine`, with its script path translated via `toWslPath`, ONLY when the
  probe found `node` inside the distro; omit it too when it did not (design D5).
  `remoteControlAtStartup: false` and `disableAgentView: true` stay unconditional.
- [ ] 4.4 Translate `AGENT_DESKTOP_SNAPSHOT_DIR` for a WSL launch; drop
  `AGENT_DESKTOP_SOCKET_PATH`, which cannot be reached from inside the distro.
- [ ] 4.5 Update `TerminalPane.svelte:692` to spawn the returned `program`/`cwd`.
  The pane's REGISTRY entry keeps the agent kind (design D4) — assert this in a
  test, since breaking it fails silently.
- [ ] 4.6 Extend `src/lib/usage/spawn.test.ts`: a WSL claude launch, a WSL copilot
  launch, and a regression case asserting non-WSL output is byte-identical to
  today's.

## 5. Context-aware capabilities (TDD)

- [ ] 5.1 Add `capabilitiesFor(backend, context)` to `src/lib/agent/backends.ts`,
  returning `backend.capabilities` unchanged when no context is given.
- [ ] 5.2 A WSL launch context clears `hooks` (and any flag derived from the event
  pipeline). Keep `statusline` — it still functions (design D5).
- [ ] 5.3 Route the pane's capability reads through it, so the gated surfaces are
  omitted rather than rendered dead.
- [ ] 5.4 Tests in `backends.test.ts` for both the context-free and WSL contexts.

## 6. Verification

- [ ] 6.1 `yarn test` green; `yarn check` and `cargo clippy` clean.
- [ ] 6.2 Confirm on macOS that agent sessions still launch and events still
  arrive — the non-WSL path must be untouched.
- [ ] 6.3 **Requires a Windows+WSL machine — cannot be done in-session.** Verify:
  `wsl.exe -l -q` lists the distro; a session launches in a
  `\\wsl.localhost\<distro>\…` folder; the detected executable appears as the
  settings placeholder; and an explicit override takes effect.

  Three assumptions were VERIFIED on the reporter's machine before implementation:
  the distro list (`Ubuntu`, `docker-desktop`); that the agent CLIs resolve inside
  the distro only via the login profile (`/home/v-patel/.local/bin/{claude,copilot}`);
  and that `node` is ABSENT there, so the statusline is omitted alongside the hooks.

  STILL UNVERIFIED — confirm on the Windows box: that the arg vector survives
  `wsl.exe` re-splitting the Win32 command line and lands in the right directory
  (`… 'cd "$1" || exit 1; shift; exec "$@"' sh /tmp pwd` must print `/tmp`),
  including a cwd containing a space.
- [ ] 6.4 Run the `adversarial-code-review` skill over the implementation diff and
  resolve every CRITICAL finding (or prove it a false positive) before archiving.
- [ ] 6.5 Run `openspec validate wsl-agent-launch` and reconcile any conversation
  drift into the artifacts.
