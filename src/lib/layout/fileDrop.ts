// Drag-drop OS files onto a running session (terminal-file-drop). With native
// drag-drop enabled (tauri.conf.json `dragDropEnabled: true`) Tauri intercepts
// the OS drop — so the WebView never navigates to the dropped `file://` (the bug
// this fixes) — and emits `onDragDropEvent` with the real absolute `paths` plus
// the cursor `position`. We resolve the SESSION PANE UNDER THE CURSOR and hand it
// the files: images become an inline image paste (clipboard + Ctrl+V), every
// other file is inserted as a quoted absolute path. A drop with no live session
// under the cursor is inert.
//
// The load-bearing PURE parts — `isImagePath`, `partitionDropPaths`,
// `physicalToCss`, `buildPathInsert` — and the dispatch core (`handleDropPaths`,
// with injectable clipboard + delay) are unit-tested. The thin Tauri/DOM
// resolvers (`paneIdUnderCursor`, `initFileDrop`) are left for manual
// verification, matching the split in `insertFilename.ts` / `pickFile.ts`.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getTerminal, type TerminalHandle } from './terminals';
import { quotePath } from './insertFilename';
import { dropTarget } from './dropTarget.svelte';

/** Lowercased extensions we hand over as inline IMAGE pastes (clipboard+Ctrl+V),
 *  rather than as inserted paths. Everything else is treated as a regular file. */
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'tif',
  'tiff'
]);

/** The Ctrl+V control byte. Claude Code's CLI reads the OS clipboard for an image
 *  when it receives this through the PTY, inserting it as `[Image #N]`. */
const CTRL_V = '\x16';

/** Cap on images pasted from a single drop, and the delay between them: the agent
 *  consumes one clipboard image per Ctrl+V, so they must be paced and bounded. */
const MAX_IMAGES_PER_DROP = 16;
const IMAGE_PASTE_DELAY_MS = 200;

/** PURE: does this path point at an image file we paste via the clipboard? Keyed
 *  on the lowercased extension after the final dot; no dot / no match → not an
 *  image (handed over as a path instead). */
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot === path.length - 1) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** PURE: split dropped paths into the ones pasted as images vs. inserted as
 *  paths, preserving each group's original order. */
export function partitionDropPaths(paths: string[]): {
  images: string[];
  others: string[];
} {
  const images: string[] = [];
  const others: string[] = [];
  for (const p of paths) (isImagePath(p) ? images : others).push(p);
  return { images, others };
}

/** PURE: map a native (physical-pixel) drop position to CSS pixels for
 *  `document.elementFromPoint`. `devicePixelRatio` defaults to 1 so a missing/odd
 *  value degrades to an identity mapping rather than throwing. */
export function physicalToCss(
  pos: { x: number; y: number },
  devicePixelRatio: number
): { x: number; y: number } {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: pos.x / dpr, y: pos.y / dpr };
}

/** PURE: the text inserted for a set of non-image paths — each quoted as a single
 *  inert shell token (reusing the insert-filename quoting), space-separated, with
 *  NO trailing space. Empty input → empty string. */
export function buildPathInsert(paths: string[]): string {
  return paths.map(quotePath).join(' ');
}

/** Injectable side-effects for `handleDropPaths`, so the dispatch order is unit-
 *  testable without the real clipboard command or wall-clock delays. */
export interface DropDeps {
  /** Place the image at `path` on the OS clipboard (the Rust command by default). */
  copyImageToClipboard: (path: string) => Promise<void>;
  /** Resolve after `ms`, to pace successive clipboard image pastes. */
  delay: (ms: number) => Promise<void>;
}

const defaultDeps: DropDeps = {
  copyImageToClipboard: (path) => invoke('copy_image_to_clipboard', { path }),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

/**
 * Hand a dropped file set to one session's terminal: insert the non-image paths
 * (quoted) at the cursor, then paste each image via clipboard + Ctrl+V, paced and
 * capped. Stops early if the PTY is dead (`sendKeys` → false). Per-image clipboard
 * failures are logged and skipped — one bad file never aborts the rest. Never
 * throws.
 */
export async function handleDropPaths(
  handle: TerminalHandle,
  paths: string[],
  deps: DropDeps = defaultDeps
): Promise<void> {
  const { images, others } = partitionDropPaths(paths);

  if (others.length > 0) handle.paste(buildPathInsert(others));

  const capped = images.slice(0, MAX_IMAGES_PER_DROP);
  if (images.length > capped.length) {
    console.warn(
      `terminal-file-drop: ${images.length} images dropped; pasting the first ${capped.length}`
    );
  }
  for (const path of capped) {
    try {
      await deps.copyImageToClipboard(path);
    } catch (err) {
      console.error('terminal-file-drop: clipboard write failed for', path, err);
      continue;
    }
    // sendKeys → false means the PTY has exited; further pastes are pointless.
    if (!handle.sendKeys(CTRL_V)) break;
    await deps.delay(IMAGE_PASTE_DELAY_MS);
  }
}

/** Resolve the live session pane under a native drop position, or `null` when the
 *  drop is over non-session chrome (no enclosing `[data-pane-id]`). Thin DOM glue;
 *  verified manually. */
function paneIdUnderCursor(pos: { x: number; y: number }): string | null {
  const { x, y } = physicalToCss(pos, window.devicePixelRatio);
  const el = document.elementFromPoint(x, y);
  const pane = el?.closest<HTMLElement>('[data-pane-id]');
  return pane?.dataset.paneId ?? null;
}

/**
 * Subscribe to native drag-drop and route file drops to the session under the
 * cursor. enter/over highlights the targeted pane; leave clears it; drop clears
 * the highlight and, when a live session is under the cursor, hands it the files.
 * Returns an unlisten fn (a no-op outside Tauri). Wired from the route's onMount.
 */
export async function initFileDrop(): Promise<() => void> {
  try {
    const webview = getCurrentWebview();
    return await webview.onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        dropTarget.paneId = paneIdUnderCursor(payload.position);
      } else if (payload.type === 'leave') {
        dropTarget.paneId = null;
      } else if (payload.type === 'drop') {
        const paneId = paneIdUnderCursor(payload.position);
        dropTarget.paneId = null;
        if (!paneId) return; // dropped on non-session chrome → inert
        const handle = getTerminal(paneId);
        if (handle) void handleDropPaths(handle, payload.paths);
      }
    });
  } catch (err) {
    console.error('initFileDrop failed', err);
    return () => {};
  }
}
