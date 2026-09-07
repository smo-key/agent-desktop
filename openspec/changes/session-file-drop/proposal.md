## Why

Dragging a file (e.g. an image) anywhere onto the app makes the macOS WebView
navigate to the dropped `file://` URL, replacing the entire app with the bare
file — a completely broken experience. There is no handler that intercepts file
drops. Users instead expect to drop files **onto a session** to hand them to the
running agent, and dropping anywhere else should simply do nothing.

## What Changes

- **BREAKING (config):** Enable Tauri native drag-drop (`dragDropEnabled: true`)
  so the OS file-drop is intercepted by the app instead of navigating the
  WebView. This is what stops the app-replacement bug.
- Add a window-level drop handler that resolves the **session pane under the
  cursor** and acts on the dropped file paths:
  - **Image files** → place the image on the OS clipboard and send `Ctrl+V`
    (`0x16`) to that session's PTY, so the agent ingests it as an inline image
    paste (`[Image #N]`) — the same way a clipboard paste works.
  - **Non-image files** → insert each file's quoted absolute path into that
    session's terminal at the cursor (reusing the existing insert-filename
    quoting), so the agent receives a real, usable path.
- Dropping over anything other than a live session (sidebar, footer, launcher,
  empty chrome) or outside the window does **nothing** — no navigation, no
  insertion.
- Show a drop-target affordance on the session pane under the cursor while a
  file is dragged over it.
- Preserve the existing project/task **drag-to-reorder**: native drag-drop is
  reported to block in-page HTML5 DnD, so if reordering breaks under the new
  config, re-implement those two reorders with pointer events (no behavior
  change).
- Add the `tauri-plugin-clipboard-manager` dependency for the image clipboard
  write.

## Capabilities

### New Capabilities
- `terminal-file-drop`: Dropping OS files onto a running session pane hands them
  to that session's agent — images as clipboard-paste image attachments,
  other files as inserted quoted paths — while drops elsewhere are inert and the
  app is never replaced by a dropped file.

### Modified Capabilities
<!-- None: reorder behavior (drag a row onto another to reorder) is unchanged at
     the requirement level; only its input mechanism may change. Image/path
     insertion reuses terminal-insert-filename's quoting without changing its
     requirements. -->

## Impact

- **Config:** `src-tauri/tauri.conf.json` — `dragDropEnabled: true`.
- **Dependencies:** add `tauri-plugin-clipboard-manager` (Rust + JS) and a
  `clipboard-manager:allow-write-image` capability.
- **Frontend:** new drop module (`src/lib/layout/fileDrop.ts`) wired from
  `src/routes/+page.svelte`; reuses the terminal handle's `sendKeys`/`paste`
  (`pty_write`) and `quotePath` from `terminal-insert-filename`; reads pane
  identity via the existing `data-pane-id` markers.
- **Reorder (contingent):** `src/lib/tasks/TasksLauncher.svelte` and
  `src/lib/projects/ProjectPanel.svelte` may move from HTML5 DnD to pointer
  events if native drag-drop breaks them.
- **Risk to verify first:** that PNG-on-clipboard + `0x16` actually yields an
  inline image in this app; fallback is a temp-file path insertion.
