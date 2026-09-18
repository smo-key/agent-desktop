// WSL launch mechanics (`wsl-agent-launch` capability). PURE and framework-free
// (no Svelte/Tauri/DOM imports) so every load-bearing guarantee here is
// unit-tested: the distro heuristic, the path translation across the VM
// boundary, and above all the argument vector, which is the difference between
// "a folder with a space in it works" and "a folder with a space in it injects
// shell syntax".
//
// Why this module exists at all: an agent pane spawns its backend's program
// (`claude`) as a WINDOWS image. When the user's shell is a WSL distro launcher
// their project lives inside the distro and `claude` is on the LINUX PATH, so
// `CreateProcessW` fails with `os error 2` (ERROR_FILE_NOT_FOUND — the image,
// not the cwd, which would be error 3). No amount of Windows-side PATH seeding
// can fix that; the executable is on the other side of a VM boundary. So the
// launch itself has to cross it.
//
// The shell preference is the ONLY trigger. This module never goes looking for
// distros on its own.

/** The wrapper every WSL launch goes through. */
const WSL_EXE = 'wsl.exe';

/**
 * The script run inside the distro. A FIXED constant — no caller input is ever
 * interpolated into it (see `wslInvocation`).
 *
 * `|| exit 1` rather than `&&`: a failed `cd` must ABORT. With `&&` the shell
 * carries on and the cost is running the agent in the wrong directory — a
 * silent, confusing failure rather than a loud one.
 *
 * The `[ -n "$1" ]` guard is NOT redundant: `cd ""` is a silent no-op in POSIX
 * sh (verified on sh, dash and bash — it exits 0 and leaves the directory
 * inherited), so an empty cwd would sail past a bare `cd "$1" || exit 1` and
 * start the agent in the distro's `$HOME`. That is exactly the silent
 * wrong-directory outcome the `|| exit 1` exists to prevent.
 *
 * It writes to stderr before exiting. A bare `exit 1` produces a pane showing
 * `[process exited (code 1)]` and nothing else, which is not louder than landing
 * in `$HOME` — just emptier.
 */
const SCRIPT =
  '[ -n "$1" ] || { echo "agent-desktop: no working directory" >&2; exit 1; }; ' +
  'cd "$1" || exit 1; shift; exec "$@"';

/**
 * The `$0` placeholder. POSIX assigns the FIRST operand after `sh -c <script>`
 * to `$0`, not `$1` — so without this literal every parameter shifts by one:
 * `cd "$1"` would target the executable and the cwd would be exec'd as the
 * command. Easy to drop, and it fails in a way that looks like a WSL problem.
 */
const ARGV0 = 'sh';

/**
 * Distro launchers registered by the common distributions.
 *
 * FULLY ANCHORED, and deliberately so. An earlier prefix-only form (`^(…|mint|arch)`)
 * matched `mintty.exe` — the Git Bash / Cygwin terminal — and `archive.exe`,
 * which would have rerouted a perfectly good shell through a VM.
 *
 * Anchoring is what fixes that, so the NAME LIST stays broad: an over-narrow
 * list silently rejects real distros (`Arch.exe`, `ubuntupreview.exe`,
 * `SLES-12-SP5.exe`) and, worse, invites someone to "correct" it later by
 * loosening the anchor again.
 *
 * An open set — a missing name is a ONE-LINE fix, and the failure mode is
 * benign: an unrecognized launcher means the app behaves exactly as it does
 * today. A FALSE POSITIVE is not benign, which is why the SHAPE errs narrow
 * even though the list does not.
 */
const DISTRO_BASES =
  'ubuntupreview|ubuntu|debian|kali-linux|kali|opensuse-leap|opensuse-tumbleweed|opensuse|suse|sles|oracle-linux|oraclelinux|fedoraremix|fedora|alpine|archlinux|arch|linuxmint|mint|clear-linux|clearlinux|pengwin|whitewater';
/**
 * A version tail must start with a SEPARATOR or a DIGIT. That is the whole
 * anti-false-positive rule: `mint` + `ty` and `arch` + `ive` are rejected because
 * letters cannot follow the base directly, while `ubuntu-24.04`, `ubuntu2404`,
 * `sles-12-sp5` and `opensuse-leap-15.6` are all accepted.
 */
const DISTRO_LAUNCHERS = new RegExp(
  `^(${DISTRO_BASES})([-_][0-9A-Za-z][0-9A-Za-z.\\-_]*|[0-9][0-9.\\-_]*)?$`,
  'i'
);

/**
 * Registered WSL entries that are NOT interactive distributions. Docker Desktop
 * registers these on every machine it is installed on — VERIFIED on the
 * reporting user's box, whose `wsl.exe -l -q` lists `Ubuntu` and
 * `docker-desktop`. Launching an agent into one would be nonsense.
 */
const PSEUDO_DISTROS = new Set(['docker-desktop', 'docker-desktop-data']);

/** Trim a program path down to its file name, for either path separator. */
function basename(program: string): string {
  const parts = program.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** True when `name` is a registered WSL entry that is not a real distro. */
export function isPseudoDistro(name: string | null | undefined): boolean {
  if (typeof name !== 'string') return false;
  return PSEUDO_DISTROS.has(name.trim().toLowerCase());
}

/**
 * Whether the configured shell launches a WSL distro — the single signal that
 * routes an agent pane through WSL.
 *
 * Covers `wsl.exe`, the System32 `bash.exe` shim (by full path only), and the
 * per-distro App Execution Aliases (`ubuntu.exe`, `ubuntu-24.04.exe`,
 * `debian.exe`, …), including the full `C:\Program Files\WindowsApps\…\ubuntu.exe`
 * spelling the field report arrived with.
 *
 * Deliberately does NOT match a bare `bash`, `/bin/bash`, or any `bash.exe`
 * outside System32: on Unix that is an ordinary shell, and on Windows it is
 * almost always Git Bash. Either false positive would reroute a working pane
 * through a VM.
 */
export function isWslShell(program: string | null | undefined): boolean {
  if (typeof program !== 'string') return false;
  const name = basename(program.trim()).toLowerCase();
  if (!name) return false;
  if (name === 'wsl' || name === 'wsl.exe') return true;
  // NOT `bash.exe` by name. The legacy WSL shim lives at
  // C:\Windows\System32\bash.exe, but on a Windows dev box the overwhelmingly
  // common bash.exe is Git for Windows (C:\Program Files\Git\bin\bash.exe),
  // with MSYS2 and Cygwin close behind. Treating those as WSL launchers would
  // spawn `wsl.exe` for a user who may have no WSL at all — inflicting the exact
  // os error 2 this capability exists to fix on a setup that worked. Only the
  // System32 shim qualifies, and only by its full path.
  if (/[\\/]system32[\\/]bash\.exe$/i.test(program.trim())) return true;
  if (!name.endsWith('.exe')) return false;
  return DISTRO_LAUNCHERS.test(name.slice(0, -'.exe'.length));
}

/**
 * Normalize a Windows path's separators, so the UNC and drive matchers below
 * only have to reason about forward slashes.
 */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/');
}

/** `//wsl.localhost/<distro>/rest` and the legacy `//wsl$/<distro>/rest`. */
const WSL_UNC = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(?:\/(.*))?$/i;
/** `C:/rest` — a Windows drive path. */
const WIN_DRIVE = /^([A-Za-z]):\/(.*)$/;

/**
 * The distro named by a working directory, or `null`. A distro-internal path
 * names its distro unambiguously, which makes it the STRONGER of the two
 * signals — stronger than pattern-matching a shell's file name.
 *
 * A pseudo-distro is never returned: it is not a launch target.
 */
export function distroFromCwd(cwd: string | null | undefined): string | null {
  if (typeof cwd !== 'string') return null;
  const m = WSL_UNC.exec(normalizeSeparators(cwd.trim()));
  if (!m) return null;
  const distro = m[1];
  return isPseudoDistro(distro) ? null : distro;
}

/**
 * The distro named by the shell launcher, or `null` for a generic launcher
 * (`wsl.exe` / the `bash.exe` shim), where the user's own default distro applies.
 *
 * Derived ONLY for an unversioned alias (`ubuntu.exe` → `Ubuntu`), where
 * capitalizing the first letter reliably reproduces the registered name. A
 * versioned alias yields `null` — see the body for why guessing is worse than
 * omitting `-d`.
 */
export function distroFromShell(program: string | null | undefined): string | null {
  if (!isWslShell(program)) return null;
  const name = basename((program as string).trim());
  const lower = name.toLowerCase();
  if (lower === 'wsl' || lower === 'wsl.exe' || lower === 'bash.exe') return null;
  if (!DISTRO_LAUNCHERS.test(name.slice(0, -'.exe'.length))) return null;
  const stem = name.slice(0, -'.exe'.length);
  if (!stem) return null;
  if (isPseudoDistro(stem)) return null;
  // ONLY an unversioned stem. For `ubuntu.exe` → `Ubuntu` the transform is
  // reliable; for a versioned alias it is a guess of a shape the registry does
  // not use (`ubuntu2404` → `Ubuntu2404`, never the registered `Ubuntu-24.04`;
  // `opensuse-leap-15.6` → `Opensuse-leap-15.6` vs. the registered
  // `openSUSE-Leap-15.6`).
  //
  // The asymmetry decides it: a WRONG `-d` hard-fails ("There is no distribution
  // with the supplied name") and the pane dies instantly, while omitting `-d`
  // falls back to the user's default distro, which is right on the common box.
  // So when the derivation cannot be trusted, we omit rather than guess — and a
  // project INSIDE the distro is unaffected either way, because its UNC path
  // carries the true registered name and wins over this signal.
  if (/[-_0-9]/.test(stem)) return null;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * The distro to launch into: the cwd when it names one (the stronger signal),
 * else the shell, else `null`.
 *
 * `null` means "omit `-d`", so `wsl.exe` applies the user's default distro. We
 * do NOT guess a name: a wrong `-d` fails outright. Note this fallback is
 * genuinely last-resort — multi-distro installs are ordinary (Docker Desktop
 * registers one on every machine), so which distro is default is not something
 * to stake a launch on when either signal is available.
 */
export function distroFor(
  shell: string | null | undefined,
  cwd: string | null | undefined
): string | null {
  return distroFromCwd(cwd) ?? distroFromShell(shell);
}

/**
 * Translate a Windows path to what the same location is called inside the distro.
 *
 *  - `\\wsl.localhost\Ubuntu\home\u` and legacy `\\wsl$\Ubuntu\home\u` → `/home/u`
 *  - `C:\Users\u\x` → `/mnt/c/Users/u/x` (the drive letter is LOWERCASED —
 *    `/mnt/C` does not exist)
 *  - an already-POSIX path is returned unchanged
 *
 * A distro root translates to `/`, never the empty string: `cd ""` would fail
 * and take the launch with it.
 */
export function toWslPath(p: string | null | undefined): string {
  if (typeof p !== 'string') return '';
  const s = normalizeSeparators(p.trim());
  if (!s) return '';

  const unc = WSL_UNC.exec(s);
  if (unc) {
    const rest = (unc[2] ?? '').replace(/\/+$/, '');
    return rest ? `/${rest}` : '/';
  }

  const drive = WIN_DRIVE.exec(s);
  if (drive) {
    const rest = drive[2] ?? '';
    return `/mnt/${drive[1].toLowerCase()}${rest ? `/${rest}` : ''}`;
  }

  return s;
}

/** What to run inside the distro. */
export interface WslInvocationInput {
  /** Target distro, or `null` to let `wsl.exe` use the user's default. */
  distro: string | null;
  /** Working directory — a Windows or POSIX path; translated here. */
  cwd: string;
  /** The executable, as named INSIDE the distro (a Linux path or a bare name). */
  exe: string;
  /** Arguments for the executable, passed through untouched. */
  args: string[];
}

/** A program/args pair ready for `pty_spawn`. */
export interface WslInvocation {
  program: string;
  args: string[];
}

/**
 * Build the WSL-wrapped invocation:
 *
 *   wsl.exe [-d <distro>] -- sh -lc '<SCRIPT>' sh <cwd> <exe> <args…>
 *
 * Two deliberate choices, both load-bearing:
 *
 * **A login shell (`-lc`), not `wsl.exe --cd`.** `--cd` is the obvious way to set
 * the directory, but `-l` sources the login profile — which is what puts
 * `~/.local/bin` on PATH inside the distro, and that is exactly where the agent
 * CLIs live (VERIFIED: `/home/v-patel/.local/bin/{claude,copilot}` on the
 * reporting user's box). Without it a bare `claude` would not resolve, for the
 * same reason `shell_path.rs` documents for macOS GUI launches. Profile ordering
 * is in our favor: a login shell sources profiles BEFORE it runs the `-c` body,
 * so our `cd` runs last and a profile that changes directory cannot defeat it.
 * Using `-lc` also means this has no dependency on `--cd` being present.
 *
 * **`wsl.exe`, not the configured `<distro>.exe`.** Those App Execution Aliases
 * have their own argument grammar (`ubuntu.exe run <cmd>`), vary between
 * distros, and offer no working-directory control. `wsl.exe` ships with every
 * WSL install and has one stable grammar. The shell setting is read as a signal,
 * not used as the launcher.
 *
 * The cwd and every argument are passed as POSITIONAL PARAMETERS. Nothing the
 * caller supplies is interpolated into the script text, so a folder name or a
 * `--settings` JSON blob containing spaces, quotes or `;` cannot split the
 * command or inject shell syntax.
 */
export function wslInvocation(input: WslInvocationInput): WslInvocation {
  const { distro, cwd, exe, args } = input;
  const target = distro && !isPseudoDistro(distro) ? ['-d', distro] : [];
  return {
    program: WSL_EXE,
    args: [...target, '--', 'sh', '-lc', SCRIPT, ARGV0, toWslPath(cwd), exe, ...args]
  };
}
