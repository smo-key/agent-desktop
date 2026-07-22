## 1. Local Windows verification loop

- [x] 1.1 Install a rustup-managed toolchain with the `x86_64-pc-windows-msvc`
  target, kept side-by-side with the existing Homebrew `rust` (which stays first
  on `PATH` and is left untouched).
- [x] 1.2 Install `cargo-xwin` for the MSVC CRT headers that `ring`'s C build
  needs.
- [x] 1.3 Create gitignored stub sidecars at
  `src-tauri/binaries/{whisper-cli,whisper-server,llama-server}-x86_64-pc-windows-msvc.exe`
  so `tauri-build` proceeds.
- [x] 1.4 Establish the baseline: 3 errors, all `cannot find 'unix' in 'os'`
  (`events.rs:22`, `orchestration.rs:30`, `orchestration.rs:331`).
- [x] 1.5 Add a `scripts/check-windows.sh` wrapper so the loop is reproducible by
  anyone, documenting the `RUSTC` pin and the xwin requirement.

## 2. IPC transport: events socket (TDD)

- [x] 2.1 Add the `interprocess` dependency to `src-tauri/Cargo.toml`.
- [x] 2.2 Add a `socket_name` helper that maps an app-data socket path to a
  platform address (fs path on Unix, `\\.\pipe\agent-desktop-events-<pid>` on
  Windows). Unit-test both branches.
- [x] 2.3 Port `events.rs` to `interprocess`'s blocking listener, leaving the
  accept-loop body, `EventState` and ring/sink behavior unchanged.
- [x] 2.4 Keep the existing Unix stale-socket unlink on Unix only.
- [x] 2.5 Existing `events.rs` tests pass unchanged on macOS.
- [x] 2.6 `cargo check --target x86_64-pc-windows-msvc` clears the `events.rs`
  errors.

## 3. IPC transport: orchestration control socket (TDD)

- [x] 3.1 Port `orchestration.rs` bind + the `UnixStream` field at line 331 to the
  `interprocess` stream type.
- [x] 3.2 Verify request/reply framing, id assignment, per-target serialization
  and the 30s timeout are untouched; existing tests pass on macOS.
- [x] 3.3 `cargo check --target x86_64-pc-windows-msvc` passes with zero errors.

## 4. Platform-correct child environment

- [x] 4.1 Add a `home_dir()` helper (`HOME`, falling back to `USERPROFILE` on
  Windows) and use it in `lib.rs:197,290`, `pr.rs:363`, `claude_title.rs:65`.
- [x] 4.2 Split `shell_path.rs` into a shared pure merge plus per-platform
  separator, well-known dirs, and login-shell probe. Unit-test the Windows branch
  (semicolon join, no `/opt/homebrew`, no probe) and assert the macOS branch is
  byte-for-byte unchanged.
- [x] 4.3 `yarn test` and `cargo test` pass on macOS.

## 5. Hooks invoked via `node`

- [x] 5.1 Change `src/lib/usage/spawn.ts` to emit `node "<path>"` for the event
  hook and statusLine commands, with quoting that survives spaces in the path.
- [x] 5.2 Update the `spawn.ts` tests for the new command form.
- [ ] 5.3 Confirm on macOS that sessions still launch and events still arrive
  (manual smoke via the running app).

## 6. Shell selection

- [x] 6.1 Add a `default_shell` Tauri command resolving `pwsh` → `powershell.exe`
  on Windows and `$SHELL` → `/bin/zsh` on Unix. Unit-test the resolver.
- [x] 6.2 Add the shell preference to the durable settings slice with
  normalization for absent/malformed values.
- [x] 6.3 Replace the four hardcoded `/bin/zsh` literals
  (`persistence.ts:202,316,368,468`, `workspace.svelte.ts:185`) with one resolver
  that prefers the stored preference and falls back to the backend default.
- [x] 6.4 Fall back to the default when a restored pane's program is unusable on
  the current platform.
- [x] 6.5 Expose the setting in `SettingsModal.svelte`, showing the resolved
  default when unset.
- [x] 6.6 Frontend tests cover: platform default, stored preference wins,
  malformed value falls back, `/bin/zsh` layout restored on Windows falls back.

## 7. Release pipeline

- [x] 7.1 Remove `continue-on-error` from the Windows matrix leg in
  `.github/workflows/release.yml` and delete the stale comments describing Windows
  as best-effort.
- [x] 7.2 Add a fast release-blocking Windows `cargo check` job.
- [x] 7.3 Confirm the NSIS/WebView2 `downloadBootstrapper` default is in effect,
  setting it explicitly in `tauri.conf.json` if it is not.
- [x] 7.4 Update `publish-release`'s gating comments so they no longer describe
  Windows as best-effort.

## 8. Verification

- [x] 8.1 `yarn check:gate` passes on macOS.
- [x] 8.2 `cargo check --target x86_64-pc-windows-msvc` passes with zero errors.
- [ ] 8.3 Run the app on macOS and confirm no regression: sessions launch, events
  and status update, orchestration ops round-trip, shell panes open.
- [ ] 8.4 CI Windows leg builds and produces an installer.
- [ ] 8.5 **Requires a Windows machine — cannot be done in-session.** Install the
  artifact on real Windows x64 and confirm: the app launches, a shell pane opens
  `pwsh`, a claude session starts, hook events arrive and drive status, and an
  orchestration op round-trips.
- [ ] 8.6 Run the `adversarial-code-review` skill over the implementation diff and
  resolve every CRITICAL finding (CLAUDE.md close-out gate).

## 9. One-line Windows install

- [x] 9.1 Add `docs/install.ps1`: detect arch, resolve the latest release's
  Windows x64 asset, verify its sha256 against the release metadata digest, run
  the installer. Pure logic in functions so it is unit-testable.
- [x] 9.2 Add `docs/tests/install_ps_test.ps1` covering the pure logic (arch
  detection, asset/digest resolution, checksum verify, unsupported messages).
- [x] 9.3 Run those tests in CI on the Windows runner — they cannot run on the
  macOS/Linux runners, which have no PowerShell.
- [x] 9.4 `docs/install.sh`: detect a Windows-like `uname` and print the
  PowerShell command instead of "coming soon"; keep the non-Windows unsupported
  message unchanged. Cover both in `docs/tests/install_test.sh`.
- [x] 9.5 README: document the Windows one-liner alongside the POSIX one.
- [x] 9.6 `yarn check:gate` passes (POSIX installer tests included).
- [ ] 9.7 **Requires a published release carrying Windows assets.** Run the
  one-liner on real Windows and confirm it installs and launches. Until such a
  release exists the script correctly reports "no Windows installer in the latest
  release" — verify that path too.
