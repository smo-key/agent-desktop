// The bundled changelog + the running version, for the What's new dialog.
//
// `CHANGELOG.md` is inlined at build time (Vite `?raw`), so the dialog shows
// exactly the section the GitHub Release body was cut from — no runtime fetch,
// no Tauri resource. `package.json`'s version arrives as the `__APP_VERSION__`
// literal (see vite.config.ts); under a dev server there is no release version,
// so `dev` is flagged and the store falls back to the newest section.

import changelog from '../../../CHANGELOG.md?raw';

export { changelog };

/** The running app's version + dev flag, as the What's new store expects. */
export function runningVersion(): { version: string; dev: boolean } {
  return { version: __APP_VERSION__, dev: import.meta.env.DEV };
}
