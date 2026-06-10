## Why

Pasting a file path into an agent's terminal today means typing it by hand or
hunting it down in another app and copying it — slow and error-prone, especially
for deep absolute paths. A right-click "Insert Filename" action (and a ⌘I
shortcut) lets the user pick a file from a native dialog and drop its quoted
absolute path straight into the prompt at the cursor.

## What Changes

- Add an **Insert Filename…** item to the agent terminal's right-click context
  menu (first section, alongside Copy/Paste), with a ⌘I shortcut hint.
- Add a global **⌘I** keyboard shortcut that performs the same action against the
  focused agent terminal.
- Both entry points open a **native file picker** (files only — folders are not
  selectable) at the OS default / last-used location.
- On selection, write the chosen file's **absolute path wrapped in double
  quotes** (any embedded `"` escaped as `\"`, no trailing space) to the focused
  agent terminal's PTY at the input cursor — the same write path as Paste.
- Cancelling the dialog inserts nothing; ⌘I is a no-op when no live agent
  terminal is focused.
- Document ⌘I in the help-modal shortcut registry.

Scope boundary: this applies to **agent terminal panes only** (the `PaneNode`
leaves that carry the pane context menu). The bare interactive shells in the
Terminals panel — which have no pane context menu today — are out of scope.

## Capabilities

### New Capabilities
- `terminal-insert-filename`: Insert a picked file's quoted absolute path into the
  focused agent terminal, via a context-menu item and the ⌘I shortcut.

### Modified Capabilities
<!-- No existing capability's requirements change. -->

## Impact

- **Frontend (Svelte/TS):**
  - `src/lib/layout/paneMenu.ts` — new menu item + `insertFilename` dep.
  - `src/lib/layout/PaneNode.svelte` — wire the dep to the picker + focused
    terminal handle.
  - New thin wrapper (analogous to `src/lib/launcher/pick.ts`) over the Tauri
    dialog plugin's `open({ directory: false, multiple: false })`.
  - `src/routes/+page.svelte` — global ⌘I handler targeting the focused terminal.
  - `src/lib/ui/shortcuts.ts` — register ⌘I in the help modal list.
- **Dependencies:** none new — `@tauri-apps/plugin-dialog` (2.7.1) and the
  `dialog:allow-open` capability are already present.
- **Backend (Rust):** none — reuses the existing dialog plugin and `pty_write`.
