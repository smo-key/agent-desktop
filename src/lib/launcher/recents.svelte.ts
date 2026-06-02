// Reactive runes store for the launcher's recent-folders list. A thin wrapper
// over the PURE `recents.ts` model: it holds the list in `$state`, runs
// `addRecent`/`parseRecents`/`serializeRecents` over it, and persists via the
// Rust `recents_load`/`recents_save` commands.
//
// PERSISTENCE CHOICE (documented): recents are stored in a SIBLING `recents.json`
// under the same app-data dir as `layout.json`, written through dedicated
// `recents_load`/`recents_save` Tauri commands that use the SAME atomic
// tmp+rename mechanism as `layout_save`. This keeps the recents file independent
// of the (debounced, much larger) layout envelope — a recents write is a tiny,
// immediate flush on each successful launch — while reusing the proven I/O path.
// The pure model (dedupe/cap/order + tolerant parse) is unit-tested in
// recents.test.ts; this file is the (headless-untestable) Tauri/runes wiring.

import { invoke } from '@tauri-apps/api/core';
import {
  addRecent,
  parseRecents,
  serializeRecents,
  DEFAULT_MAX_RECENTS
} from './recents';

/** The reactive recent-folders store. A single instance is exported below. */
export class RecentsStore {
  /** Recent folder paths, most-recent first. Deep-reactive via the runes proxy. */
  list = $state<string[]>([]);

  /** True once `load()` has resolved (so the UI can distinguish empty vs unloaded). */
  loaded = $state(false);

  /**
   * Load the persisted recents from `recents.json` and seed the store. On ANY
   * failure (no file, bad JSON, non-Tauri context) the list stays empty — this
   * never throws. Call once on mount.
   */
  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await invoke<string | null>('recents_load');
    } catch (err) {
      console.error('recents_load failed', err);
      raw = null;
    }
    this.list = parseRecents(raw);
    this.loaded = true;
  }

  /**
   * Record `path` as the most-recent folder (dedupe + cap) and persist the new
   * list. Called after a session is SUCCESSFULLY spawned for `path`. A blank
   * path is ignored by the pure model; persistence is best-effort (a failed
   * write never breaks the launch).
   */
  async add(path: string, max: number = DEFAULT_MAX_RECENTS): Promise<void> {
    const next = addRecent(this.list, path, max);
    // No change (e.g. already at the head, or a blank path) -> skip the write.
    if (next.length === this.list.length && next.every((p, i) => p === this.list[i])) {
      return;
    }
    this.list = next;
    await this.save();
  }

  /** Persist the current list via the Rust `recents_save` command (best-effort). */
  private async save(): Promise<void> {
    try {
      await invoke('recents_save', { json: serializeRecents(this.list) });
    } catch (err) {
      console.error('recents_save failed', err);
    }
  }
}

/** The singleton recents store, imported by the launcher UI (Stage 2). */
export const recents = new RecentsStore();
