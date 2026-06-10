## Why

Agents and shells constantly print file paths (diffs, stack traces, `ls` output, "edited `src/foo.ts`"). Today those paths are inert text — to open one the user must select it, copy it, and paste it into an editor or Finder. Treating paths as clickable links (the convention in iTerm2, VS Code's terminal, and Cursor) removes that friction and makes the terminal feel native.

## What Changes

- Hold **⌘ (Cmd)** and hover over a token in the terminal that resolves to an existing file or directory: the token renders with a **dotted underline** and the cursor becomes a pointer, signalling it is actionable.
- **⌘-click** that token: the file/directory opens via the user's **open-with preferences** — code files, HTML files, and other files each route to a chosen application (or the OS default). Defaults to the system handler; configurable in a new Settings dialog.
- Path resolution is **cwd-aware**: relative tokens (`src/lib/foo.ts`, `./build`, `../README.md`) resolve against the pane's working directory; absolute and `~`-prefixed paths resolve directly. Tokens that don't map to an existing path are not linkified.
- Common trailing decorations are stripped before resolution: a `:line[:col]` suffix (e.g. `src/foo.ts:42:8`), surrounding quotes/parens, and trailing punctuation.
- Releasing ⌘ or moving off the token removes the underline immediately; the feature never alters normal (no-modifier) terminal selection, scrolling, or click behaviour.

## Capabilities

### New Capabilities
- `terminal-file-links`: ⌘-hover detection, dotted-underline affordance, cwd-aware path resolution, and ⌘-click open for file paths printed in a terminal pane.
- `open-with-preferences`: a persisted, per-file-type (code / HTML / other) choice of which application opens a file, plus a Settings dialog (title-bar gear) to edit it. Used by terminal ⌘-clicks and transcript file links alike.

### Modified Capabilities
<!-- None: there are no published specs in openspec/specs/ yet; the base app is still an unarchived change. -->

## Impact

- **Frontend** — `src/lib/TerminalPane.svelte`: register an xterm link provider (the `@xterm/addon-web-links` pattern, or a custom `registerLinkProvider`) gated on the ⌘ modifier; wire activation to a new open command. The pane already holds `cwd` (props / workspace registry) for resolution.
- **Backend** — `src-tauri/src/lib.rs`: add an `open_path(path, app)` Tauri command (`open <path>`, or `open -a <app> <path>` when an app is set) plus `settings_load`/`settings_save` (mirroring `recents_*`, persisting `settings.json`). Register them in the command handler.
- **Frontend** — `src/lib/settings/openWith.svelte.ts` (prefs store + classify/resolve), `src/lib/ui/SettingsModal.svelte` + `settingsStore.svelte.ts` (the dialog), a title-bar gear button in `+page.svelte`, and a `settings` icon. `src/lib/overview/editor.ts` routes transcript opens through the same prefs.
- **Capabilities/deps** — no new Tauri plugin required (reuses the `std::process::Command` approach already used by `open_in_editor`). The terminal affordance is implemented by hand (self-managed overlay + cursor), not via `@xterm/addon-web-links`.
- **Resolution validity** — relies on the pane's spawn-time `cwd`; paths relative to a directory the agent later `cd`-ed into may not resolve. This is an accepted limitation (see design.md), not a regression of existing behaviour.
