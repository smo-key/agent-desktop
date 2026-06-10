## 1. Path quoting helper (pure)

- [x] 1.1 Add a pure `quotePath(abs: string): string` helper that wraps the path in
      double quotes, escapes any embedded `"` as `\"`, and appends no trailing space
      (place it where it can be imported by both the menu wiring and tests; e.g. a
      small `layout/insertFilename.ts` or alongside the picker wrapper).
- [x] 1.2 Unit-test `quotePath`: plain path → `"<path>"`; path containing `"` →
      escaped `\"`; verify no trailing space.

## 2. File picker wrapper

- [x] 2.1 Add `pickFile(defaultPath?: string): Promise<string | null>` mirroring
      `src/lib/launcher/pick.ts`, wrapping `open({ directory: false, multiple: false })`;
      return `null` on cancel / unavailable dialog / error (no throw).

## 3. Context-menu item

- [x] 3.1 In `src/lib/layout/paneMenu.ts`, add `insertFilename(): void` to
      `PaneMenuDeps` and an `{ id: 'insert-filename', label: 'Insert Filename…',
      shortcut: '⌘I', run: () => deps.insertFilename() }` item to the first section,
      after Paste (not disabled by selection state).
- [x] 3.2 Update `src/lib/layout/paneMenu.test.ts` to cover the new item: it is
      present in the first section, has the ⌘I hint, is not disabled, and `run()`
      invokes the injected `insertFilename` dep.
- [x] 3.3 In `src/lib/layout/PaneNode.svelte` `openMenu`, implement the
      `insertFilename` dep: `pickFile()` → if a path is returned, `handle?.paste(quotePath(path))`.

## 4. ⌘I global shortcut

- [x] 4.1 Add a focused-agent-terminal resolver (shared so `+page.svelte` and
      `PaneNode` don't duplicate the focused-id → paneId → `getTerminal` mapping).
      (Done in group 1's commit as `focusedTerminalHandle()` in `layout/insertFilename.ts`.)
- [x] 4.2 In `src/routes/+page.svelte` `onKeydown`, add a `meta && (key === 'i' ||
      key === 'I')` branch BEFORE the `if (!view.isGrid) return;` grid gate: resolve
      the focused agent terminal handle, run `pickFile()` → `handle.paste(quotePath(path))`,
      `preventDefault()`, and no-op (no dialog) when there is no live focused terminal.
      (Resolves the handle FIRST via `focusedTerminalHandle()` so no dialog opens
      when nothing is focused; then funnels through `insertFilenameInto(handle)`.)

## 5. Help-modal registry

- [x] 5.1 In `src/lib/ui/shortcuts.ts`, add `{ keys: ['⌘', 'I'], label: 'Insert file
      path into terminal' }` to the `Session` group.

## 6. Verify

- [x] 6.1 Run the unit tests and the project's typecheck/lint; confirm `quotePath`
      and `paneMenu` tests pass and there are no type errors.
      (`npx vitest run` → 769/769 pass; `npm run check` → 0 errors / 0 warnings.)
- [ ] 6.2 Manual check (native dialog is not headless-testable): right-click an agent
      terminal → Insert Filename… → pick a file → quoted path appears at the cursor;
      cancel inserts nothing; ⌘I does the same for the focused terminal.
      (REQUIRES the running app — left for the developer to verify manually.)
