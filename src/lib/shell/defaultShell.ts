// The program a shell pane launches (`shell-selection` capability).
//
// Replaces the `/bin/zsh` literals that used to be hardcoded in four places in
// the layout code — a macOS-only assumption that produced an immediately-dead
// pane on Windows. Resolution order is:
//
//   1. the user's stored preference (settings.json `ui.shell`), when usable here
//   2. the PLATFORM default resolved by the backend `default_shell` command
//      (`pwsh` → `powershell.exe` on Windows, `$SHELL` → `/bin/zsh` on Unix)
//
// The platform default comes from Rust because only the backend can read the
// real process environment and probe `PATH` for `pwsh`. It is hydrated once at
// startup via `setPlatformDefaultShell`; until then the Unix default stands so
// nothing can spawn `undefined`.

/** The Unix default, and the pre-hydration value (existing macOS behavior). */
export const UNIX_DEFAULT_SHELL = '/bin/zsh';

let platformDefault = UNIX_DEFAULT_SHELL;
let storedPreference: string | null = null;

/**
 * Record the backend-resolved platform default. Called once on mount with the
 * result of the `default_shell` command.
 */
export function setPlatformDefaultShell(value: string | null | undefined): void {
  if (typeof value === 'string' && value.trim()) {
    platformDefault = value.trim();
  }
}

/** The backend-resolved platform default (what applies when no preference is set). */
export function platformDefaultShell(): string {
  return platformDefault;
}

/** Record the user's stored preference. `null`/empty clears it (use the default). */
export function setShellPreference(value: string | null | undefined): void {
  storedPreference = typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The user's stored preference, or `null` when unset. */
export function shellPreference(): string | null {
  return storedPreference;
}

/**
 * The program a NEW shell pane should launch: the stored preference when set and
 * usable on this platform, else the platform default.
 */
export function defaultShell(): string {
  return resolveProgram(storedPreference, platformDefault);
}

/**
 * True when `program` looks like a Windows executable or path.
 *
 * Deliberately does NOT treat a bare `pwsh` as Windows-only: PowerShell 7 runs on
 * Linux and macOS (`brew install powershell`), so rejecting it there would
 * silently discard a legitimate choice. Only a drive/UNC path or an explicit
 * Windows executable extension counts.
 */
function looksWindows(program: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(program) || // C:\… or C:/…
    program.startsWith('\\\\') || // UNC
    /\.(exe|cmd|bat)$/i.test(program)
  );
}

/** True when `program` looks like a Unix absolute path (`/bin/zsh`). */
function looksUnix(program: string): boolean {
  return program.startsWith('/');
}

/**
 * Whether this host is Windows.
 *
 * An EXPLICIT signal rather than something inferred from the resolved default
 * shell: inferring made the whole app's notion of its platform hinge on one
 * string, so a Windows box defaulting to `pwsh` (no drive letter, no `.exe`)
 * would read as Unix and reject every Windows program in a restored layout.
 * Detected from the user agent (same approach as `overview/alerts.svelte.ts`)
 * and overridable for tests.
 */
function detectWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Win/i.test(navigator.userAgent ?? navigator.platform ?? '');
}

let hostWindows = detectWindows();

/** Override the detected platform (tests, and any future backend-authoritative signal). */
export function setHostIsWindows(value: boolean): void {
  hostWindows = value;
}

/** True when this host is Windows. */
export function hostIsWindows(): boolean {
  return hostWindows;
}

/**
 * Whether `program` can plausibly be launched on this host. This is what stops a
 * layout authored on macOS (recording `/bin/zsh`) from spawning a dead pane when
 * the same profile is restored on Windows, and vice-versa.
 */
export function isLaunchableHere(program: string, windows: boolean = hostWindows): boolean {
  if (windows) return !looksUnix(program);
  return !looksWindows(program);
}

/**
 * Resolve the program to actually spawn. PURE — the layout/persistence code calls
 * this instead of falling back to a hardcoded `/bin/zsh`.
 *
 * Falls back to `fallback` when `stored` is absent, blank, not a string, or not
 * launchable on this platform.
 */
export function resolveProgram(
  stored: string | null | undefined,
  fallback: string = platformDefault
): string {
  if (typeof stored !== 'string') return fallback;
  const trimmed = stored.trim();
  if (!trimmed) return fallback;
  if (!isLaunchableHere(trimmed)) return fallback;
  return trimmed;
}
