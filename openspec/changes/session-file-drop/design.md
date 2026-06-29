## Context

The app runs each agent (e.g. Claude Code) in an `@xterm/xterm` terminal backed
by a PTY; the frontend streams raw bytes to the PTY via `pty_write` (exposed on
each pane's terminal handle as `paste`/`send`/`sendKeys`). Pane roots carry a
`data-pane-id` attribute and register a handle in a per-pane registry
(`getTerminal(paneId)`).

Today `src-tauri/tauri.conf.json` sets `dragDropEnabled: false`. Commit
`1d7d9af` set this deliberately because Tauri v2's native OS drag-drop handler
intercepts and blocks **all** in-page HTML5 drag-and-drop, which is what powers
the project (`ProjectPanel.svelte`) and task (`TasksLauncher.svelte`)
drag-to-reorder. The side effect: with native drag-drop off, the WebView treats
a file drop as a default navigation to the dropped `file://` URL, replacing the
whole app — the bug this change fixes.

There is already a one-place quote-and-paste flow for handing a file path to a
terminal: `terminal-insert-filename` (`quotePath` + `handle.paste`), used by ⌘O
and the pane context menu. This change adds drag-drop as a second trigger for
the same idea, plus an image-specific path.

Research into Claude Code's CLI confirms: an image becomes an inline `[Image #N]`
attachment **only** via a clipboard paste — the CLI reads the OS clipboard when
it receives `Ctrl+V` (`0x16`, which travels through the PTY). A bare image path
typed into the prompt does **not** auto-attach as an image. Non-image files, by
contrast, are best handed over as a real absolute path.

## Goals / Non-Goals

**Goals:**
- Dropping a file onto a live session hands it to that session's agent.
- Images arrive as inline image attachments (`[Image #N]`), like a clipboard
  paste; other files arrive as inserted quoted absolute paths.
- The drop targets the session **under the cursor**; drops anywhere else (and
  outside the window) do nothing.
- The app is never replaced by a dropped file.
- Project/task drag-to-reorder keeps working (no user-visible regression).

**Non-Goals:**
- No change to what the agent does with the file once handed over.
- No multi-window or non-session drop targets (no "drop on the launcher to open").
- No restoring the user's prior clipboard contents after an image paste (the
  pasted image is left on the clipboard, matching normal paste semantics).
- Linux/Windows image-paste reliability is out of scope for this change
  (macOS-first; Claude Code's clipboard-image read is reliable on macOS only).

## Decisions

### D1: Enable native drag-drop (`dragDropEnabled: true`) to get real paths
Supporting **all** files requires the dropped file's real absolute path. In a
WKWebView, the HTML5 `drop` event's `File` objects do **not** expose a
filesystem path; only Tauri's native drag-drop (`onDragDropEvent`) provides
`paths: string[]`. Enabling it also makes Tauri intercept the drop, which fixes
the navigate-to-`file://` bug for free.

- **Alternative — keep `dragDropEnabled: false`, use HTML5 `drop`:** simpler and
  keeps reorder untouched, but can only obtain file *bytes*, never a path — so
  non-image files cannot be handed over as a usable path. Rejected because the
  agreed scope is all files.

### D2: Images via clipboard + `Ctrl+V`; non-images via quoted-path insert
Partition the dropped paths by file extension. Non-image paths reuse
`quotePath` + `handle.paste` (the `terminal-insert-filename` flow). Image paths
are written to the OS clipboard as an image, then `0x16` is sent to that pane's
PTY via `handle.sendKeys('\x16')`, so the agent ingests them as `[Image #N]`.

- **Alternative — insert image paths as text too:** uniform and simple, but the
  CLI would not render them as inline images, defeating the user's explicit
  "insert the image, like Cmd+V" request. Rejected.
- **Image decode happens in Rust:** the clipboard image is raw RGBA, not an
  encoded blob. A custom `copy_image_to_clipboard(path)` command reads the file,
  decodes it (`image` crate — png/jpeg/gif/webp/bmp) to RGBA, and writes it via
  the clipboard plugin's Rust API. This transparently handles non-PNG formats and
  keeps the frontend trivial (`invoke` then `sendKeys('\x16')`), avoiding a JS
  canvas re-encode, a JS clipboard package, and the asset-protocol scope a
  webview file read would need.

### D3: Resolve the target pane by cursor position
On `drop`/`over`, convert the native event `position` (physical px) to CSS px
(`÷ window.devicePixelRatio`) and use `document.elementFromPoint(x, y)
?.closest('[data-pane-id]')` to find the session under the cursor. No
`[data-pane-id]` ancestor ⇒ the drop is "elsewhere" ⇒ no action. This reuses the
existing DOM markers rather than maintaining separate geometry.

- **Alternative — hit-test against the `rects.svelte` registry:** available, but
  needs leaf→pane mapping and duplicates what the DOM already answers. Rejected
  as redundant.

### D4: Preserve reorder with pointer events, but only if actually broken
Native drag-drop is reported to block HTML5 DnD. Implementation **first verifies
empirically** whether project/task reorder still works with the flag on. If it
does, no reorder change is made. If it is broken, both reorders are
re-implemented with pointer events (pointerdown/move/up + the existing
`reorder()` calls), preserving identical behavior. Pointer-based DnD is immune
to the native-drag-drop interception.

### D5: New dependencies `tauri-plugin-clipboard-manager` + `image`
The clipboard write uses the plugin's Rust `ClipboardExt::write_image`, called
from our own `copy_image_to_clipboard` command — so the frontend never invokes a
clipboard IPC command and **no clipboard capability is granted** (capabilities
gate frontend IPC, not Rust API calls). The `image` crate decodes the dropped
file to RGBA. `0x16` reuses the existing `pty_write` path via the terminal
handle's `sendKeys` — no new backend command for the keystroke. No JS clipboard
package is added.

### D6: Multiple / mixed files
A drop may carry several paths. Non-image paths are inserted (space-separated).
Image paths are pasted **sequentially** with a short delay between each, since
the agent consumes one clipboard image per `Ctrl+V`.

## Risks / Trade-offs

- **[Clipboard+`0x16` may not yield `[Image #N]` in this app]** → Verify with a
  spike as the first implementation step. Fallback: write the image to a temp
  file and insert its quoted path (a path, not an inline image) — flagged to the
  user before proceeding rather than silently shipping a worse UX.
- **[Enabling native drag-drop regresses project/task reorder]** → D4: verify
  first; reimplement with pointer events if broken. The reorder rewrite is the
  largest risk surface in this change.
- **[Sequential multi-image paste timing is heuristic]** → Use a conservative
  inter-image delay; cap the number of images pasted in one drop and log if
  truncated rather than firing an unbounded burst.
- **[Pasting an image clobbers the user's clipboard]** → Accepted (Non-Goal);
  matches normal paste semantics.
- **[`position`→CSS mapping or `elementFromPoint` misfires under the overlay
  title bar]** → The WebView spans the full window; verify the mapping during
  the spike and adjust the offset if needed.
