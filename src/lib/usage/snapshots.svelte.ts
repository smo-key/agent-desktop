// Runes store for the usage dashboard's per-pane snapshots (Milestone 3, design
// D3/D7). The statusline wrapper writes one JSON file per pane; a Rust
// `SnapshotWatcher` parses each create/modify and pushes it to the frontend as a
// `usage://snapshot` Tauri event. This store maps `pane_id -> snapshot`, seeded
// from `usage_snapshots()` on mount and updated on each event.
//
// The event-apply logic is factored into a PURE reducer `apply(map, snapshot)`
// (no Svelte/Tauri imports) so it is trivially unit-testable: applying a valid
// snapshot updates the map by `pane_id`; a null/malformed payload is ignored. The
// reactive store is a thin wrapper that runs the reducer over `$state`.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Git status for a pane's workspace dir (stable shape; fields nullable). `branch`
 * + `dirty` are the original fields; `ahead` (vs upstream) and `behind` (vs
 * origin/main) are additive and OPTIONAL so a legacy snapshot without them still
 * types. The wrapper always emits all four (null off-repo).
 */
export interface GitStatus {
  branch: string | null;
  dirty: boolean | null;
  ahead?: number | null;
  behind?: number | null;
}

/**
 * A per-pane usage snapshot — the exact wire shape the statusline wrapper writes
 * and the Rust watcher emits. Field names are snake_case to match that payload
 * verbatim; the store keys on `pane_id` (NOT `session_id`, so a resume/fork that
 * changes the session id never orphans the card).
 */
export interface Snapshot {
  pane_id: string;
  session_id: string | null;
  model: string | null;
  task: string | null;
  /** Context window usage 0..100, or null when unknown. */
  context_pct: number | null;
  /** Account-global rate-limit object verbatim, or null when absent. */
  rate_limits: Record<string, unknown> | null;
  /** Total session cost in USD, or null. */
  cost: number | null;
  git: GitStatus | null;
  /** Unix timestamp (SECONDS) — drives the live/idle heartbeat. */
  ts: number;
}

/** A pane_id -> snapshot map (the store's whole state). */
export type SnapshotMap = Record<string, Snapshot>;

/**
 * Whether `value` is a usable snapshot: a plain object carrying a non-empty
 * string `pane_id`. This is the ONLY validation the reducer needs — the Rust
 * watcher already skipped unparseable files, but a null/garbage payload (or a
 * future malformed emit) must never poison the map or throw.
 */
function isSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { pane_id?: unknown }).pane_id === 'string' &&
    (value as { pane_id: string }).pane_id.length > 0
  );
}

/**
 * PURE reducer: return a NEW map with `snapshot` stored under its `pane_id`,
 * leaving every other pane's last value intact. A null/malformed payload (no
 * string `pane_id`) is IGNORED — the same `map` reference is returned unchanged,
 * so the dashboard keeps rendering the last valid state for every pane.
 *
 * Never mutates the input `map`. This is the unit-tested core of the store.
 */
export function apply(map: SnapshotMap, snapshot: unknown): SnapshotMap {
  if (!isSnapshot(snapshot)) return map;
  return { ...map, [snapshot.pane_id]: snapshot };
}

/**
 * Reactive snapshots store. Holds the `pane_id -> snapshot` map in `$state` and
 * applies the pure reducer on seed + on each event. Later UI stages read
 * `byPane` / `list` to render the two-row dashboard; here we only own ingestion.
 */
export class SnapshotsStore {
  /** The live pane_id -> snapshot map. Deep-reactive via the runes proxy. */
  byPane = $state<SnapshotMap>({});

  /** Every current snapshot as an array (for `{#each}` over the session cards). */
  get list(): Snapshot[] {
    return Object.values(this.byPane);
  }

  /** The snapshot for a pane, or `undefined` if none has arrived yet. */
  get(paneId: string): Snapshot | undefined {
    return this.byPane[paneId];
  }

  /**
   * Apply one (possibly malformed) payload through the pure reducer, committing
   * the result. A no-op when the payload is ignored (reducer returns the same
   * reference), so a bad event never triggers a spurious reactive update.
   */
  ingest(snapshot: unknown): void {
    const next = apply(this.byPane, snapshot);
    if (next !== this.byPane) this.byPane = next;
  }

  /** Replace the whole map (used by `seed`). */
  private replace(map: SnapshotMap): void {
    this.byPane = map;
  }

  /**
   * Prune ghost snapshots: drop every `byPane` entry whose key (the `pane_id`) is
   * NOT in `liveIds` (the union of pane ids that still exist across all open
   * workspaces). A pane that closed leaves a stale snapshot behind otherwise,
   * which would show up as a ghost agent, inflate cost totals, and keep its
   * (now-dead) session in the foreign exclude-set. Idempotent: when every key is
   * live this leaves the map (and its reference) untouched, so it never triggers a
   * spurious reactive update.
   */
  retain(liveIds: Set<string>): void {
    const dead = Object.keys(this.byPane).filter((paneId) => !liveIds.has(paneId));
    if (dead.length === 0) return;
    const next: SnapshotMap = {};
    for (const [paneId, snap] of Object.entries(this.byPane)) {
      if (liveIds.has(paneId)) next[paneId] = snap;
    }
    this.byPane = next;
  }

  /**
   * Seed the store from the current snapshot set via the `usage_snapshots`
   * command (so panes that already have a snapshot render immediately, before
   * any event). Folds each through the pure reducer. Resolves to the count
   * seeded; on failure (e.g. outside Tauri) it logs once and leaves the map
   * untouched rather than throwing.
   */
  async seed(): Promise<number> {
    try {
      const snaps = await invoke<unknown[]>('usage_snapshots');
      let map: SnapshotMap = {};
      for (const s of snaps) map = apply(map, s);
      this.replace(map);
      return Object.keys(map).length;
    } catch (err) {
      console.warn('usage_snapshots seed failed; starting empty:', err);
      return 0;
    }
  }

  /**
   * Subscribe to live `usage://snapshot` pushes, ingesting each through the pure
   * reducer. Returns an unlisten function the caller invokes on teardown (e.g.
   * `onMount`'s cleanup). On failure (outside Tauri) resolves to a no-op
   * unlisten so callers needn't special-case it.
   */
  async listen(): Promise<UnlistenFn> {
    try {
      return await listen<Snapshot>(SNAPSHOT_EVENT, (event) => {
        this.ingest(event.payload);
      });
    } catch (err) {
      console.warn('usage://snapshot listen failed; no live updates:', err);
      return () => {};
    }
  }

  /**
   * Convenience: seed then start listening, returning the unlisten fn. The usual
   * mount path. Seeding first means the initial set is in place before the first
   * live push is applied.
   */
  async start(): Promise<UnlistenFn> {
    await this.seed();
    return this.listen();
  }
}

/** The Tauri event name the Rust watcher emits each parsed snapshot on. */
export const SNAPSHOT_EVENT = 'usage://snapshot';

/** Singleton store, imported by the dashboard UI (later stages) + the route. */
export const snapshots = new SnapshotsStore();
