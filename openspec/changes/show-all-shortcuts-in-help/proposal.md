# Show all keyboard shortcuts in the help (`?`) window

## Why

The keyboard-shortcuts help modal renders a single `SHORTCUTS` registry, kept in
sync with the actual key handlers by hand. Several bindings users can actually
trigger were never added to that registry, so the `?` window under-reported what
the app can do: `⌘T`, `⌘J`, `⌘Y`, `⌘Tab`, the bare `?`, and `⌘⇧↑/↓`.

## What changes

- Add the missing functional shortcuts to the `SHORTCUTS` registry so the help
  modal lists every shortcut a user can trigger.
- Pin the registry against handler drift with a test that asserts each functional
  binding is present.
- Inert grid-only bindings (`⌘[`, `⌘]`, `Alt`+Arrow) are deliberately excluded —
  their handler is gated behind `view.isGrid`, which never activates in the inbox
  view, so they never fire.

## Impact

- Affected specs: `keyboard-shortcuts` (new capability).
- Affected code: `src/lib/ui/shortcuts.ts`, `src/lib/ui/shortcuts.test.ts`.
