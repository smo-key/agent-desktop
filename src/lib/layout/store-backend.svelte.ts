// Persistence WIRING: connects the pure `persistence.ts` round-trip to the
// reactive workspace store, the Tauri `layout_load`/`layout_save` commands, and
// the window-close flush. This is the only persistence file that imports Tauri +
// the runes store; `persistence.ts` itself stays pure + unit-tested.
//
// Lifecycle (driven from the route's onMount via `initPersistence`):
//   1. LOAD:    invoke('layout_load') -> raw JSON | null.
//   2. RESTORE: restoreState(raw) -> rebuild every workspace (per-ws migrate +
//               validateTree, graceful fallback to a fresh claude workspace on
//               any failure). store.restoreFrom(...) swaps the workspace list.
//               Rendering the restored PaneNodes RE-SPAWNS one PTY per leaf via
//               each TerminalPane's mount (saved shell + cwd only — tmux-resurrect
//               semantics; no live process state).
//   3. WATCH:   a $effect reads the serializable state; any change schedules a
//               ~250ms-debounced save (rapid split/close/resize/focus coalesce
//               into a single write).
//   4. FLUSH:   getCurrentWindow().onCloseRequested awaits a synchronous flush of
//               any pending write before the window closes — so the layout file
//               is persisted before Rust's CloseRequested handler kills the PTYs.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Debouncer,
  restoreState,
  serializeState,
  type RestoredWorkspace
} from './persistence';
import { workspace, type WorkspaceEntry } from './workspace.svelte';

/** Debounce interval for layout writes (ms). Rapid mutations coalesce into one. */
const SAVE_DEBOUNCE_MS = 250;

/** Serialize the live store and persist it via the Rust `layout_save` command. */
async function saveNow(): Promise<void> {
  const state = serializeState(
    workspace.serializableEntries as RestoredWorkspace[],
    workspace.activeWorkspaceId
  );
  try {
    await invoke('layout_save', { json: JSON.stringify(state) });
  } catch (err) {
    // Persistence is best-effort: a failed write must never break the app. The
    // next mutation reschedules a save; on-quit flush gets a final attempt.
    console.error('layout_save failed', err);
  }
}

/**
 * The debounced save. `flush()` (on quit) needs to AWAIT the in-flight write, so
 * the action records its promise and `flushSave` awaits it after flushing.
 */
let inFlight: Promise<void> | null = null;
const debouncer = new Debouncer(() => {
  inFlight = saveNow();
}, SAVE_DEBOUNCE_MS);

/** Force any pending write now and await it (the on-quit path). */
async function flushSave(): Promise<void> {
  debouncer.flush(); // runs saveNow() synchronously if a write was pending
  if (inFlight) await inFlight;
}

/**
 * Load + restore the persisted layout, returning the active workspace id the
 * caller should consider current. On ANY failure this resolves to a fresh
 * single-pane `claude` workspace (restoreState never throws).
 */
export async function restorePersistedLayout(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await invoke<string | null>('layout_load');
  } catch (err) {
    // Couldn't even read the file -> fall through to a fresh workspace.
    console.error('layout_load failed', err);
    raw = null;
  }

  const restored = restoreState(raw, workspace.nodeIdFactory);
  // `RestoredWorkspace` is structurally a `WorkspaceEntry` ({id,name,ws,registry}).
  workspace.restoreFrom(restored.workspaces as WorkspaceEntry[], restored.activeWorkspaceId);
}

/**
 * Wire up the debounced save + on-quit flush. Returns an unsubscribe/cleanup fn
 * the route should call on destroy. Must run inside a Svelte effect scope (it
 * uses `$effect`) — i.e. call it from the component body or onMount-with-root.
 */
export function watchAndPersist(): () => void {
  // Reactively serialize-and-schedule on every meaningful change. Reading the
  // workspaces (and their nested ws/registry, deep-reactive via the proxy) plus
  // the active id makes this effect re-run on split/close/resize/focus/rename/
  // new/switch — each just (re)arms the debounce timer.
  const stop = $effect.root(() => {
    $effect(() => {
      // Touch the reactive state so this effect subscribes to it. We walk the
      // entries (and a few nested fields) so deep mutations re-trigger.
      const entries = workspace.workspaces;
      void workspace.activeWorkspaceId;
      for (const e of entries) {
        void e.name;
        void e.ws.root;
        void e.ws.focusedId;
        void e.registry;
      }
      debouncer.schedule();
    });
  });

  // Flush any pending write before the window closes (the handler is awaited by
  // Tauri, so the save completes before the native close proceeds and before the
  // Rust CloseRequested handler kills the PTYs). Guarded so a re-entrant close
  // can't double-flush.
  let unlistenClose: (() => void) | null = null;
  let flushing = false;
  void getCurrentWindow()
    .onCloseRequested(async () => {
      if (flushing) return;
      flushing = true;
      await flushSave();
    })
    .then((un) => {
      unlistenClose = un;
    })
    .catch((err) => {
      // Non-Tauri context (e.g. plain browser preview) — no window to listen on.
      console.error('onCloseRequested wiring failed', err);
    });

  return () => {
    stop();
    debouncer.cancel();
    unlistenClose?.();
  };
}
