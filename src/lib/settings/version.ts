// Resolves the human-facing app-version label shown at the bottom of Settings.
//
// `package.json` is the single source of version truth (see scripts/sync-version.sh,
// which propagates it into tauri.conf.json / Cargo.toml at release time), and Vite
// injects it as the `__APP_VERSION__` literal at build time. In development
// (`vite dev` / `tauri dev`) there is no meaningful release version, so we show
// "dev" instead of a number.

export interface AppVersionInput {
  /** Build-time version string (package.json's `version`, via Vite `define`). */
  version: string;
  /** True when running under a dev server (`import.meta.env.DEV`). */
  dev: boolean;
}

/**
 * Build the version label for the Settings footer:
 *   - dev mode              -> "dev"
 *   - a real version string -> "v<version>" (e.g. "v0.1.10")
 *   - missing/blank version -> "unknown" (defensive; should not occur in a build)
 */
export function appVersionLabel({ version, dev }: AppVersionInput): string {
  if (dev) return 'dev';
  const v = (version ?? '').trim();
  return v.length > 0 ? `v${v}` : 'unknown';
}
