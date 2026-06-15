## 1. De-risk the core mechanism (spike first)

- [ ] 1.1 Spike: with a manual setup, put a PNG on the OS clipboard and write
  `0x16` to a live Claude Code PTY; confirm the agent shows `[Image #N]`. If it
  does not, STOP and report — switch images to the temp-file-path fallback
  before continuing.
- [ ] 1.2 Set `dragDropEnabled: true` in `src-tauri/tauri.conf.json`, run the
  app, and verify whether project/task drag-to-reorder still works. Record the
  result — it decides whether section 8 (reorder rewrite) is needed.

## 2. Clipboard image dependency

- [ ] 2.1 Add `tauri-plugin-clipboard-manager` to `src-tauri/Cargo.toml` and
  register it in the Tauri builder (`src-tauri/src/lib.rs`).
- [ ] 2.2 Add the JS package `@tauri-apps/plugin-clipboard-manager` to
  `package.json`.
- [ ] 2.3 Grant `clipboard-manager:allow-write-image` in the window capability
  under `src-tauri/capabilities/`.

## 3. Pure helpers (TDD)

- [ ] 3.1 Write tests for an `isImagePath(path)` / file-type classifier
  (extension-based: png/jpg/jpeg/gif/webp/bmp/svg... → image), then implement it.
- [ ] 3.2 Write tests for partitioning a list of dropped paths into
  `{ images, others }`, then implement it.
- [ ] 3.3 Write tests for the physical→CSS coordinate mapping
  (`position / devicePixelRatio`), then implement it.
- [ ] 3.4 Write tests for building the non-image insert string (quote each path
  via the existing `quotePath`, join with single spaces, no trailing space),
  then implement it — reusing `quotePath` from `terminal-insert-filename`.

## 4. Image clipboard-paste bridge

- [ ] 4.1 Implement reading an image file to PNG bytes, re-encoding non-PNG via a
  canvas `toDataURL('image/png')` (the `logo.ts` technique).
- [ ] 4.2 Implement writing the PNG to the OS clipboard (`writeImage`) and sending
  `0x16` to a given terminal handle via `sendKeys('\x16')`.
- [ ] 4.3 Implement sequential multi-image paste with a conservative inter-image
  delay; cap the count and log when truncated.

## 5. Drop module and wiring

- [ ] 5.1 Create `src/lib/layout/fileDrop.ts`: subscribe to
  `getCurrentWebview().onDragDropEvent`, resolve the target pane via
  `elementFromPoint(...).closest('[data-pane-id]')` → `getTerminal(paneId)`.
- [ ] 5.2 On `drop` over a live session: partition paths, insert non-image quoted
  paths via `handle.paste`, paste images via the section-4 bridge; no-op when no
  session is under the cursor.
- [ ] 5.3 Wire the module's lifecycle (subscribe/unsubscribe) into
  `src/routes/+page.svelte` `onMount`.

## 6. Drop-target affordance

- [ ] 6.1 Add a small reactive store for the current drop-target pane id; set it
  on `enter`/`over` (when over a session), clear it on `leave`/`drop`/non-session.
- [ ] 6.2 Render a drop-target affordance on the targeted pane
  (`TerminalPane.svelte` / `PaneNode.svelte`), respecting existing styling tokens.

## 7. Verify the fix end-to-end

- [ ] 7.1 Confirm dropping an image onto a session yields `[Image #N]`; dropping a
  non-image inserts its quoted path; dropping over chrome/outside does nothing;
  the app is never replaced.

## 8. Preserve reorder (only if 1.2 showed it broke)

- [ ] 8.1 Re-implement `ProjectPanel.svelte` drag-to-reorder with pointer events
  (pointerdown/move/up) calling the existing `projects.reorder`, preserving the
  drop highlight; remove the now-inert HTML5 `draggable`/`ondrag*` wiring.
- [ ] 8.2 Re-implement `TasksLauncher.svelte` drag-to-reorder with pointer events
  calling `projectTasks.reorder`, preserving the highlight; remove the HTML5 DnD
  wiring.
- [ ] 8.3 Verify projects and tasks still reorder and persist as before.

## 9. Close-out

- [ ] 9.1 Run `yarn check` and `yarn test`; fix any fallout.
- [ ] 9.2 Update help/docs if drop-to-session is worth surfacing to users.
- [ ] 9.3 Run `openspec validate session-file-drop` and reconcile any drift.
