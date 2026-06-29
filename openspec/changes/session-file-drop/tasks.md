## 1. De-risk the core mechanism (needs a running app — interactive)

- [ ] 1.1 Verify clipboard+`0x16`: drop an image on a live Claude Code session and
  confirm it appears as `[Image #N]`. If it does NOT, switch images to the
  temp-file-path fallback before considering the change done.
- [x] 1.2 Set `dragDropEnabled: true` in `src-tauri/tauri.conf.json`.
- [ ] 1.2a Verify whether project/task drag-to-reorder still works under the new
  config — decides whether section 8 (reorder rewrite) is needed.

## 2. Backend: clipboard image command

- [x] 2.1 Add `tauri-plugin-clipboard-manager` and `image` to
  `src-tauri/Cargo.toml`.
- [x] 2.2 Register the clipboard plugin in the Tauri builder (`src-tauri/src/lib.rs`).
- [x] 2.3 Add the `copy_image_to_clipboard(path)` command (decode → RGBA →
  `ClipboardExt::write_image`) and register it in the invoke handler. No JS
  clipboard package or capability needed (Rust API is not IPC-gated).
- [x] 2.4 `cargo check` passes.

## 3. Pure helpers (TDD)

- [x] 3.1 `isImagePath(path)` — extension-based image classifier (tested).
- [x] 3.2 `partitionDropPaths(paths)` → `{ images, others }`, order-preserving (tested).
- [x] 3.3 `physicalToCss(pos, dpr)` — physical→CSS coordinate mapping (tested).
- [x] 3.4 `buildPathInsert(paths)` — quote each via `quotePath`, space-joined, no
  trailing space (tested).

## 4. Image clipboard-paste bridge

- [x] 4.1 `handleDropPaths(handle, paths, deps)` — insert non-image quoted paths,
  then paste each image via `copy_image_to_clipboard` + `sendKeys('\x16')`,
  sequential, capped, dead-PTY-aware, per-image-failure tolerant (tested).

## 5. Drop module and wiring

- [x] 5.1 `src/lib/layout/fileDrop.ts`: subscribe to `onDragDropEvent`, resolve the
  target pane via `elementFromPoint(...).closest('[data-pane-id]')` →
  `getTerminal(paneId)`.
- [x] 5.2 On `drop` over a live session, dispatch via `handleDropPaths`; no-op when
  no session is under the cursor.
- [x] 5.3 Wire `initFileDrop` lifecycle into `src/routes/+page.svelte` `onMount`.

## 6. Drop-target affordance

- [x] 6.1 `dropTarget` reactive store; set on enter/over (over a session), clear on
  leave/drop/non-session.
- [x] 6.2 Render an accent-ring overlay on the targeted pane in `TerminalPane.svelte`
  (above the launch spinner, pointer-events:none).

## 7. Verify the fix end-to-end (needs a running app — interactive)

- [ ] 7.1 Confirm: dropping an image onto a session yields `[Image #N]`; dropping a
  non-image inserts its quoted path; dropping over chrome/outside does nothing;
  the app is never replaced.

## 8. Preserve reorder (only if 1.2a showed it broke)

- [ ] 8.1 Re-implement `ProjectPanel.svelte` drag-to-reorder with pointer events
  calling the existing `projects.reorder`, preserving the highlight; remove the
  inert HTML5 `draggable`/`ondrag*` wiring.
- [ ] 8.2 Re-implement `TasksLauncher.svelte` drag-to-reorder with pointer events
  calling `projectTasks.reorder`, preserving the highlight; remove the HTML5 DnD
  wiring.
- [ ] 8.3 Verify projects and tasks still reorder and persist.

## 9. Close-out

- [x] 9.1 `yarn run check` and `yarn run test` pass.
- [ ] 9.2 Update help/docs if drop-to-session is worth surfacing to users.
- [ ] 9.3 `openspec validate session-file-drop` and reconcile any drift.
