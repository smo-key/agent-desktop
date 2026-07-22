// Shared xterm color themes for dark/light mode (theming spec S3/S4).
// `TerminalPane` constructs its `Terminal` with `termThemeFor(theme.resolved)`
// and keeps it live via `term.options.theme = ...` reassignment whenever the
// resolved app theme changes — xterm 6 supports live theme reassignment
// without recreating the terminal. A shared module (rather than a per-pane
// const) so every mounted pane (dozens can exist at once; workspaces stay
// mounted even when hidden) reads the exact same two theme objects.

import type { ITheme } from '@xterm/xterm';

/** Dark terminal theme — the original "GitHub-ish dark" palette, unchanged.
 *  Note: the xterm 6 key is `selectionBackground` (the old `selection` key
 *  was removed). */
export const DARK_TERM_THEME: ITheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  cursorAccent: '#0d1117',
  selectionBackground: '#284766',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
};

/** Light terminal theme — a "GitHub-ish light" palette mirroring the same
 *  ANSI-color roles as DARK_TERM_THEME, tuned for a white terminal canvas. */
export const LIGHT_TERM_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#0969da',
  cursorAccent: '#ffffff',
  selectionBackground: '#b6e3ff',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f'
};

/** Resolve the xterm `ITheme` for a resolved app theme ('dark' | 'light'). */
export function termThemeFor(resolved: 'dark' | 'light'): ITheme {
  return resolved === 'light' ? LIGHT_TERM_THEME : DARK_TERM_THEME;
}
