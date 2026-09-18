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

The `[ -n "$1" ]` guard is not belt-and-braces. `cd ""` is a silent NO-OP in
POSIX sh — verified on sh, dash and bash, where it exits 0 and leaves the
inherited directory — so an empty cwd sails straight past `cd "$1" || exit 1` and
starts the agent in `$HOME`. An earlier version of this design asserted the
opposite in a comment; the guard makes the claim true.

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
user's default distro.

**Verified on the reporter's machine**, which corrected the reasoning here.
`wsl.exe -l -q` returned:

```
Ubuntu
docker-desktop
```

Multi-distro installs are ordinary, not exotic — Docker Desktop registers a
`docker-desktop` pseudo-distro on every machine it is installed on. The original
justification for omitting `-d` ("the overwhelmingly common single-distro
install") is therefore wrong, and omitting `-d` is a weaker fallback than it
looked: it stakes the launch on which distro happens to be marked default.

This does not change the resolution ORDER — the reporter's own case resolves from
the shell basename (`ubuntu.exe` → `Ubuntu`) and never reaches the fallback. What
changes is the fallback's confidence. It stays last-resort, and `isPseudoDistro`
excludes the known non-interactive entries (`docker-desktop`,
`docker-desktop-data`) so they can never be chosen as a target.

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

### D5. Omit every env-addressed pipeline under WSL

**This decision was wrong twice before it was right, so the reasoning is recorded
in full.**

*First version:* drop the hooks (socket unreachable), keep the statusline (writes
a file, which `/mnt/c/…` reaches). *Second version, after probing the real box:*
keep the statusline only when the distro has `node`, since the wrapper runs as
`node "<path>"` — and that box has no `node`. *Final version, after an
adversarial review:* omit the statusline unconditionally, because `node` was
never the binding constraint.

The constraint is the ENVIRONMENT. The app tells each pipeline where to deliver
by passing `AGENT_DESKTOP_PANE`, `AGENT_DESKTOP_SNAPSHOT_DIR` and
`AGENT_DESKTOP_SOCKET_PATH` to the spawned process. Windows environment variables
do **not** propagate into a distro unless they are named in `WSLENV`, and nothing
here sets it. `statusline-wrapper.cjs` writes no snapshot at all unless BOTH
`AGENT_DESKTOP_PANE` and `AGENT_DESKTOP_SNAPSHOT_DIR` are present. So the
retained statusline would have burned a node process per render to produce
nothing — precisely the cost used to justify dropping the hooks.

The tell was visible in the code without knowing any WSL semantics: the second
version translated `AGENT_DESKTOP_SNAPSHOT_DIR` to `/mnt/c/…` (treating env as
crossing) while dropping `AGENT_DESKTOP_SOCKET_PATH` (reasoning the in-distro
process could not use it). The delivery mechanism for the two is identical, so
one of those decisions had to be wrong.

| Pipeline | Addressed by | Under WSL |
| --- | --- | --- |
| Event hook | `AGENT_DESKTOP_SOCKET_PATH` | **Omitted.** Never arrives; and a `\\.\pipe\…` name is unopenable from Linux even if it did. |
| Statusline | `AGENT_DESKTOP_SNAPSHOT_DIR` | **Omitted.** The directory is reachable, but the session is never told where it is. |

`remoteControlAtStartup: false` and `disableAgentView: true` stay unconditional —
they are correctness settings, not observability.

This is a real avenue rather than a dead end: setting `WSLENV` (with the `/p`
flag, which path-translates a value automatically) would deliver both variables
and could restore the statusline without any manual translation. It needs
verification on real WSL, so it is deliberately not done here. The `node` probe
is kept for exactly that follow-up.

A further avenue for the hooks, recorded but NOT pursued: WSL's binfmt interop
can execute Windows binaries, so invoking the hook as `/mnt/c/.../node.exe` would
make it a real Windows process able to open the `\\.\pipe\…` socket. That needs
its own verification and its own change.

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
