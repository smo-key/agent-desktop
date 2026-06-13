# Tasks

- [x] 1.1 Add a `CompactModeStore` (`compactMode` settings slice, defaults OFF)
      mirroring the auto-advance store, with a pure `parseCompactModePrefs`
      validator and unit tests.
- [x] 1.2 Load the compact-mode preference on mount in `+page.svelte`.
- [x] 1.3 Add a "Sessions panel → Compact mode" checkbox to the Settings modal,
      wired to the store.
- [x] 1.4 Gate the roster row's third (`.meta`) line in `Inbox.svelte` so it is
      omitted when compact mode is enabled.
- [x] 1.5 Run `npm run test` and `npm run check` — all green.
