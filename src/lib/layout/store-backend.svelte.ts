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
  pruneEmptySessions,
  restoreState,
  serializeState,
  type RestoredState,
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
 * Load + restore the persisted layout. FIRST LAUNCH (no persisted layout) starts
 * with ZERO workspaces — we never fabricate an agent the user didn't ask for; the
 * overview shows its empty state until they launch their first mission. A saved
 * layout restores normally (and an explicitly-empty saved layout stays empty,
 * rather than re-creating an agent). `restoreState` never throws.
 */
export async function restorePersistedLayout(): Promise<void> {
  let raw: string | null = null;
  try {
    raw = await invoke<string | null>('layout_load');
  } catch (err) {
    // Couldn't even read the file -> start empty (do NOT fabricate an agent).
    console.error('layout_load failed', err);
    raw = null;
  }

  // No persisted layout at all -> empty workspace list, no auto-spawned agent.
  if (raw == null || raw.trim() === '') return;

  const restored = restoreState(raw, workspace.nodeIdFactory);
  // Drop agent windows that were created but never used (a saved session with no
  // transcript history) — but keep every session that has any history.
  const pruned = await pruneUnusedSessions(restored);
  // `RestoredWorkspace` is structurally a `WorkspaceEntry` ({id,name,ws,registry}).
  workspace.restoreFrom(pruned.workspaces as WorkspaceEntry[], pruned.activeWorkspaceId);
}

/**
 * Resolve which restored `claude` panes have real transcript history (the user
 * sent at least one message — Rust reports `userHash` non-null for those) and
 * prune the rest via `pruneEmptySessions`. On any failure we keep EVERYTHING:
 * losing an unused window is acceptable, silently dropping a real session is not.
 */
async function pruneUnusedSessions(state: RestoredState): Promise<RestoredState> {
  const panes: { paneId: string; sessionId: string; cwd: string | null }[] = [];
  for (const w of state.workspaces) {
    for (const [paneId, s] of Object.entries(w.registry)) {
      if (s.program === 'claude' && s.sessionId) {
        panes.push({ paneId, sessionId: s.sessionId, cwd: s.cwd });
      }
    }
  }
  if (panes.length === 0) return state;

  const withHistory = new Set<string>();
  try {
    const map = await invoke<Record<string, { userHash?: string | null }>>('activity_for', {
      panes
    });
    for (const [paneId, act] of Object.entries(map)) {
      if (act && act.userHash) withHistory.add(paneId);
    }
  } catch (err) {
    console.error('activity_for (restore prune) failed; restoring all sessions', err);
    return state;
  }

  return pruneEmptySessions(state, (paneId) => withHistory.has(paneId));
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
