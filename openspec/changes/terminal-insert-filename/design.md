## Context

The agent terminal is an xterm pane (`TerminalPane.svelte`) backed by a PTY on the
Rust side. Text is "typed" into it by writing bytes to the PTY via the `pty_write`
Tauri command; the running shell/TUI places them at its own input cursor. The pane
already exposes an imperative handle through a registry (`layout/terminals.ts`):
`TerminalHandle.paste(text)` is exactly "write this text to the PTY at the cursor."

The right-click menu for an agent pane is built by the pure function
`buildPaneMenu(deps)` (`layout/paneMenu.ts`) and rendered by the singleton
`PaneContextMenu.svelte` via the `contextMenu` store. `PaneNode.svelte`'s `openMenu`
wires the `deps` (close/newSession/copy/paste) and resolves the right pane's handle
with `getTerminal(node.paneId)`. Copy/Paste already follow this exact shape, so the
new action slots in beside them.

Global keyboard shortcuts live in `onKeydown` in `routes/+page.svelte` (bound via
`<svelte:window onkeydown>`). ⌘I is currently unbound. The native folder picker for
the launcher (`launcher/pick.ts`) is a thin wrapper over the Tauri dialog plugin's
`open(...)`; the file picker mirrors it.

## Goals / Non-Goals

**Goals:**
- One context-menu action + one ⌘I shortcut that pick a file and insert its quoted
  absolute path into the focused agent terminal at the cursor.
- Reuse the existing menu/handle/PTY-write plumbing; keep the picker wrapper and
  the path-quoting logic small and unit-testable.

**Non-Goals:**
- Folder selection (the picker is files-only, by decision).
- Surfacing the action on the bare Terminals-panel shells (they have no pane menu).
- A custom/native "files-or-folders in one dialog" command.
- Defaulting the dialog to the agent's working directory (OS default/last-used).

## Decisions

### D1 — Insertion = `paste(text)` to the focused terminal handle
"Insert at the cursor" maps to writing bytes to the PTY; the TUI/shell positions
them at its input cursor. `TerminalHandle.paste` already does exactly this (it calls
`pty_write` and is a no-op when the PTY is dead). The action therefore resolves the
focused pane's handle and calls `paste(quoted)`. No new handle method is required.
*Alternative considered:* a dedicated `insertText` handle method — rejected as a
needless duplicate of `paste`.

### D2 — File picker wrapper mirrors `pick.ts`
Add `pickFile(defaultPath?)` (new module, e.g. `launcher/pickFile.ts`) wrapping
`open({ directory: false, multiple: false })`, returning `string | null` (null on
cancel, unavailable dialog, or error — same contract as `pickFolder`). No
`defaultPath` is passed by callers (OS default/last-used). Keeping it a separate
tiny module preserves the "small, mockable surface" pattern and lets tests stub it.
*Alternative considered:* extend `pick.ts` with a `directory` param — rejected to
keep each wrapper's contract a single, obvious shape.

### D3 — Path quoting in a pure helper
A pure `quotePath(abs)` returns `"<abs>"` with every embedded `"` replaced by `\"`
and no trailing space. Pure + framework-free so it is unit-tested without a DOM or
the Tauri bridge (matching how `paneMenu` is tested). Backslashes are NOT otherwise
escaped — on macOS this is for a shell/TUI prompt and double-quote escaping is the
one case that would break the quoting; over-escaping would corrupt normal paths.

### D4 — Menu item in `buildPaneMenu`
Add `insertFilename(): void` to `PaneMenuDeps` and an item
`{ id: 'insert-filename', label: 'Insert Filename…', shortcut: '⌘I', run: () => deps.insertFilename() }`
to the **first** section, after Paste. Not disabled by selection state (it doesn't
depend on one); like Paste it simply no-ops if the PTY is dead. `PaneNode.openMenu`
implements the dep: `async () => { const p = await pickFile(); if (p) handle?.paste(quotePath(p)); }`.

### D5 — ⌘I handler targets the focused terminal regardless of view
Add a branch to `onKeydown` BEFORE the `if (!view.isGrid) return;` grid gate (that
gate makes pane shortcuts inert because the live terminal is shown in the inbox).
The handler resolves the focused agent pane's handle and runs the same
pick→quote→paste flow; it `preventDefault()`s and is a no-op when no live focused
terminal exists. Focused-pane resolution reuses the same source the menu/focus logic
uses (`workspace` focused id → pane id → `getTerminal`); a shared helper avoids
duplicating that mapping between `+page.svelte` and `PaneNode`.
*Alternative considered:* handle ⌘I inside `TerminalPane` per-pane — rejected; the
global handler already centralizes ⌘-shortcuts and must work while xterm has focus.

### D6 — Document ⌘I in the shortcut registry
Add `{ keys: ['⌘', 'I'], label: 'Insert file path into terminal' }` to the `Session`
group in `ui/shortcuts.ts` so the help modal stays in sync (the registry documents,
it does not wire, the binding).

## Risks / Trade-offs

- **⌘I intercepted while typing in the terminal** → Intended: the feature's purpose
  is to insert into the focused terminal. The handler `preventDefault()`s so no stray
  `i`/`\t`-ish byte reaches the PTY. Acceptable because ⌘I has no terminal meaning.
- **Native dialog can't be exercised headlessly** → The picker call is isolated in
  `pickFile` and treated as a manual verification, exactly like `pickFolder`;
  automated tests cover `quotePath` and the menu/dep wiring, not the OS dialog.
- **Path with embedded quote** → Handled by escaping `"` as `\"` in `quotePath`;
  covered by a unit test. Other characters need no escaping inside double quotes.
- **No focused terminal when ⌘I fires** → No-op (no dialog opens), so the shortcut is
  inert outside an agent terminal context rather than opening a pointless picker.
