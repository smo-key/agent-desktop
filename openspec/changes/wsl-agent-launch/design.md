## Context

Two facts from the field report fix the shape of this change.

**The failure is on the image, not the cwd.** `CreateProcessW` returned
`os error 2` (`ERROR_FILE_NOT_FOUND`); a bad working directory returns error 3
(`ERROR_PATH_NOT_FOUND`). So the missing thing is `claude` itself, which lives on
the Linux `PATH` inside the distro.

**A detected path cannot be spawned directly.** The requirement says to detect
the executable *in WSL*. Whatever that probe returns —
`/home/v-patel/.local/bin/claude` — is a Linux path. `CreateProcessW` cannot
execute it. Detection and wrapping are therefore not two independent features;
the first is only useful in the presence of the second.

The existing code has the seam this needs. `TerminalPane.svelte:692` calls
`pty_spawn` with `program` and `cwd` taken straight from the pane, alongside the
`{ args, env }` that `buildSpawnOverride` returns. Everything this change does at
launch time happens in that one call.

## Goals / Non-Goals

**Goals**
- An agent pane launches successfully when the shell is a WSL distro launcher and
  the project lives inside the distro.
- Each agent CLI's executable is detected where the shell implies, and is
  overridable per backend from the settings modal with the detected value shown
  as a placeholder.
- The degradation is honest: surfaces that cannot work under WSL are omitted, not
  rendered broken.

**Non-Goals**
- Bridging the event socket into the distro (see the proposal's limitations).
- Reading a WSL-side transcript for the overview's activity.
- Reaching Linux-side descendants during teardown.
- Detecting WSL when the user has NOT configured a WSL shell. The shell
  preference is the only signal; the app does not go looking for distros.
- Shelling out to `wslpath` for translation.

## Decisions

### D1. `sh -lc` rather than `wsl.exe --cd`

`wsl.exe --cd <dir>` is the obvious way to set the working directory, but it is a
relatively recent flag and this change is being authored on macOS with no way to
verify the flag's presence on the user's build. The login-shell form needs no
verification and solves a second problem at the same time:

```
wsl.exe [-d <distro>] -- sh -lc 'cd "$1" || exit 1; shift; exec "$@"' sh <cwd> <exe> <args…>
```

`-l` sources the login profile, which is what puts `~/.local/bin` on `PATH`
inside the distro. Without it, a bare `claude` would fail to resolve for exactly
the reason `shell_path.rs` documents for macOS GUI launches. `exec` replaces the
shell so the process tree gains no extra layer, and the arguments ride in
`"$@"` rather than being interpolated into the script text, so a path containing
a space or a quote cannot break the command or inject shell syntax.

The argument vector is easy to get subtly wrong, so it is worth spelling out.
With `sh -c '<script>' a b c`, POSIX assigns the FIRST operand after the script
to `$0`, not `$1`. Hence the literal `sh` placeholder: it takes `$0`, leaving
`$1` = cwd and `$2…` = the command. After `shift`, `"$@"` is exactly the command
and its arguments.

`|| exit 1` rather than `&&`: a failed `cd` must abort. Chaining with `&&` leaves
the exit status to carry the failure while the shell continues parsing, and the
cost of getting that wrong is executing the agent in the wrong directory — a
silent, confusing failure rather than a loud one.

Profile ordering works in our favor here, and it is worth recording why. A login
shell sources `/etc/profile` and `~/.profile` BEFORE it executes the `-c` command
string, so a profile that changes directory cannot defeat the `cd` in our script:
ours runs last and wins. (Were the order reversed, this form would be unusable.)

Choosing this form means the change has no dependency on an unverified flag.

### D2. `wsl.exe -d <distro>`, not the configured `ubuntu.exe`

The user's shell is an App Execution Alias under
`C:\Program Files\WindowsApps\…`. Those per-distro launchers have their own
argument grammar (`ubuntu.exe run <cmd>`), vary between distros, and offer no
working-directory control. `wsl.exe` is present on every WSL install and has one
stable grammar.

So the shell setting is read as a *signal* — "this user works inside WSL" — and
is not itself used to launch agent panes. Shell panes keep launching the exact
program the user configured; nothing about that changes.

### D3. The cwd names the distro better than the shell does

Two signals disagree in general, and the stronger one should win:

| Signal | Yields | Reliability |
| --- | --- | --- |
| `\\wsl.localhost\Ubuntu\…` cwd | `Ubuntu` | Unambiguous — the distro is *in* the path |
| `ubuntu-24.04.exe` shell basename | `Ubuntu-24.04` | Heuristic — a name we pattern-match |
| neither | `None` → default distro | `wsl.exe` with no `-d` |

So `distroFor(shell, cwd)` prefers the cwd when it is a WSL UNC path (both the
current `\\wsl.localhost\` and the legacy `\\wsl$\` forms), falls back to the
shell basename, and otherwise omits `-d` entirely and lets `wsl.exe` pick the
user's default distro. Omitting `-d` is a better failure mode than guessing wrong:
a wrong `-d` fails outright, while no `-d` works for the overwhelmingly common
single-distro install.

### D4. The pane's `program` must not become the executable

`backends.ts` states it directly: *"Programs and kinds are the same strings by
construction"*, and `backendForProgram` is a literal `=== 'claude'` check.
Layout persistence, `isAgentProgram`, status derivation and the subagent rows all
key on that equality, and `resolveProgram` would begin rewriting a value that had
become a real path. If `program` became `wsl.exe` or a Linux path, every one of
those would break **silently** — the pane would launch and the app would simply
stop recognizing it as an agent.

So the executable resolution and the WSL wrapper are applied at the spawn seam
and nowhere else. `buildSpawnOverride` grows `program` and `cwd` in its return
value; the pane's registry entry is untouched. The existing test asserting
`resolveProgram('claude') === 'claude'` confirms bare kinds already pass through
the shell resolver unharmed.

### D5. Degrade hooks, keep the statusline

The two observability pipelines fail for different reasons, and collapsing them
into one flag would discard a pipeline that still works.

| Pipeline | Delivery | Under WSL |
| --- | --- | --- |
| Event hook | `AGENT_DESKTOP_SOCKET_PATH`, a `\\.\pipe\…` name | **Cannot work.** A Linux process cannot open a Windows named pipe. |
| Statusline wrapper | Writes a file into `AGENT_DESKTOP_SNAPSHOT_DIR` | **Works**, once the path is translated to `/mnt/c/…`. |

The statusline's survival depends on one thing that must be PROBED, not assumed:
the wrapper is invoked as `node "<path>"`, and that is `node` **inside the
distro** — a different install from any Windows one. So D5 is conditional:
retain `statusLine` when `node` is present in the distro, and omit it like the
hooks when it is not. Task 2.2's probe therefore covers `node` alongside the
agent CLIs.

What does NOT threaten it, having checked the wrapper's source: the delegation to
the user's real `~/.claude/hooks/statusline.js` resolves against the LINUX home
under WSL, where it will usually be absent. That is harmless. `delegate()` returns
early when the hook is missing (`statusline-wrapper.cjs:113`) and `main()`
documents the snapshot half as *"entirely independent of (a)"* — so a missing
user statusline costs an empty in-pane bar, never the snapshot the dashboard
reads.

Emitting the hooks anyway would be worse than omitting them: `spawn.ts` already
warns that a hook which fails to run is silent, so the session would *look*
healthy while spawning a `node` process per lifecycle event to fail into the
void. Instead the `hooks` key is omitted from `--settings` for a WSL pane and the
backend declares `hooks: false`, which routes through the `agent-backends`
degradation mechanism (design D1: a feature gated on an undeclared flag is
omitted, never rendered empty or broken).

`remoteControlAtStartup: false` and `disableAgentView: true` stay unconditional —
they are correctness settings, not observability.

This makes `capabilities` a function of launch context rather than kind alone,
which is the one genuinely new idea in `agent-backends`. It is expressed as a
`capabilitiesFor(backend, context)` function so the static `backend.capabilities`
remains the no-context default and every existing caller keeps working.

### D6. Detection is advisory, and cached by shell

The probe runs `sh -lc 'command -v claude …'` inside the distro, reusing the
`SHELL_TIMEOUT` guard `shell_path.rs` already applies to its login-shell probe —
a distro that is not running must be booted by the probe, which is exactly the
blocking case that bound exists for.

Two properties matter:

- **Advisory.** A failed or empty probe fills no placeholder and blocks nothing.
  The launch falls back to the bare backend kind, which is today's behavior.
- **Keyed by shell, not `OnceLock`.** `resolved_path()` caches for the process
  lifetime because `PATH` cannot change under it. The agent executables *can*:
  they are a function of the shell preference, and the requirement says the
  placeholder reflects "the current auto-detected one **based on the shell**".
  A process-lifetime cache would leave a Linux path in the placeholder after the
  user switched back to `pwsh`. So the cache is keyed by the shell it was probed
  with, and `ShellStore.setProgram` — which today only saves — triggers
  re-detection.

## Risks

- **Unverified against real WSL.** This is authored on macOS. D1 removes the
  dependency on an unverified flag, and the pure modules are fully unit-tested,
  but the end-to-end launch cannot be exercised here. Tasks that require a
  Windows+WSL machine are marked as such, matching how `windows-x64-support`
  handles its own 8.5 / 9.7.
- **The WSL-shell heuristic will have holes.** `<distro>.exe` is an open set.
  It is confined to one pure, tested function so a missing name is a one-line
  fix, and the failure mode is benign: an unrecognized launcher means the app
  behaves exactly as it does today.
- **First launch may be slow.** If the distro is not running, `wsl.exe` boots it.
  The probe is bounded by `SHELL_TIMEOUT`; the launch itself is not, and will
  simply take as long as the distro takes to start.
