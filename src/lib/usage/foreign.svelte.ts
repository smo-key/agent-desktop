// Runes store for EXTERNAL (foreign) Claude sessions — sessions running OUTSIDE
// the app, with no app-managed pane/snapshot (Milestone 4, design D7; requirement
// "Direct-Watch Fallback For Foreign Sessions"). The Rust side watches
// `~/.claude/tasks/` + `$TMPDIR/claude-ctx-<sid>.json`, derives each foreign
// session's task + context + heartbeat, EXCLUDES every app-launched session id,
// and pushes the filtered list as a `usage://foreign` Tauri event. This store
// seeds via the `foreign_sessions(app_session_ids)` command on mount, keeps that
// app-session exclude-set current as the app's pane set changes, and applies each
// live push.
//
// The Rust filter already excludes app sessions, but the app's snapshot set can be
// fresher than the watcher's last recompute (a brand-new pane whose session id has
// not yet been pushed). So the store applies a SECOND, belt-and-suspenders client
// filter via the PURE `mergeForeign(list, appSessionIds)` view-model — kept
// framework-free and unit-tested — guaranteeing the UI never shows an app pane as
// "external" even for the brief window before the next `foreign_sessions` call.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * One external Claude session — the exact wire shape the Rust foreign watcher
 * emits (serialized snake_case to match the snapshot payload the frontend already
 * keys on). The list the frontend receives already excludes app-launched panes.
 */
export interface ForeignSession {
  /** The Claude session id (the tasks-dir name + this list's key). */
  session_id: string;
  /** Derived current task (newest `in_progress` `activeForm`), or null. */
  task: string | null;
  /** Context-window usage 0..100 from the context bridge, or null. */
  context_pct: number | null;
  /** Heartbeat (newest of task-entry mtime / bridge ts), unix SECONDS, or null. */
  ts: number | null;
}

/** Whether `value` is a usable ForeignSession: an object with a non-empty
 *  string `session_id`. The only validation the reducer needs — a null/garbage
 *  payload must never poison the list or throw. */
function isForeign(value: unknown): value is ForeignSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { session_id?: unknown }).session_id === 'string' &&
    (value as { session_id: string }).session_id.length > 0
  );
}

/**
 * PURE merge/filter view-model: take the raw foreign list (from the command or an
 * event payload) and the set of app-launched pane session ids, and return the
 * sessions to render as "external" — every valid foreign session whose id is NOT
 * an app session, sorted by `session_id` for a stable order, with malformed
 * entries dropped. This is the client-side guard that mirrors the Rust filter so
 * an app pane is NEVER shown as external, even before the next `foreign_sessions`
 * round-trip updates the backend exclude-set.
 *
 * Never mutates its inputs. This is the unit-tested core of the store.
 *
 * @param list           the raw foreign list (possibly containing malformed items)
 * @param appSessionIds  the app-launched pane session ids to exclude
 */
export function mergeForeign(list: unknown, appSessionIds: Iterable<string>): ForeignSession[] {
  if (!Array.isArray(list)) return [];
  const exclude = new Set(appSessionIds);
  return list
    .filter(isForeign)
    .filter((f) => !exclude.has(f.session_id))
    .slice()
    .sort((a, b) => a.session_id.localeCompare(b.session_id));
}

/**
 * Reactive foreign-sessions store. Holds the raw list (as pushed by the watcher)
 * plus the app-session exclude-set in `$state`, and exposes the filtered `list`
 * via the pure view-model. The UI reads `list` to render the muted "external"
 * cards in the usage bar.
 */
export class ForeignStore {
  /** The raw foreign list last received from the command/event. */
  private raw = $state<ForeignSession[]>([]);

  /** The app-launched pane session ids to exclude (the client-side guard). */
  private appSessionIds = $state<string[]>([]);

  /** The external sessions to render: raw list minus app sessions, sorted. */
  get list(): ForeignSession[] {
    return mergeForeign(this.raw, this.appSessionIds);
  }

  /** Apply one (possibly malformed) event payload as the new raw list. A non-array
   *  payload is ignored (keeps the last list), so a bad event never blanks the UI. */
  ingest(payload: unknown): void {
    if (Array.isArray(payload)) {
      this.raw = payload.filter(isForeign);
    }
  }

  /**
   * Seed (and re-seed) from the `foreign_sessions(app_session_ids)` command:
   * pushes the current app-session exclude-set to the Rust watcher AND captures it
   * for the client-side guard, then stores the freshly-computed list. Call on
   * mount and whenever the app's pane/session set changes. On failure (e.g. outside
   * Tauri) it logs once and leaves the list untouched rather than throwing.
   *
   * @param appSessionIds the session ids of the app's currently-launched panes
   */
  async seed(appSessionIds: string[]): Promise<number> {
    this.appSessionIds = appSessionIds.slice();
    try {
      const list = await invoke<unknown[]>('foreign_sessions', {
        appSessionIds
      });
      this.raw = Array.isArray(list) ? list.filter(isForeign) : [];
      return this.raw.length;
    } catch (err) {
      console.warn('foreign_sessions seed failed; starting empty:', err);
      return 0;
    }
  }

  /**
   * Update ONLY the client-side exclude-set (no command round-trip) — used to keep
   * the guard current cheaply when the pane set changes between full seeds. The
   * Rust exclude-set is updated on the next `seed` call.
   */
  setAppSessions(appSessionIds: string[]): void {
    this.appSessionIds = appSessionIds.slice();
  }

  /**
   * Subscribe to live `usage://foreign` pushes, ingesting each. Returns an unlisten
   * function the caller invokes on teardown. On failure (outside Tauri) resolves to
   * a no-op unlisten so callers needn't special-case it.
   */
  async listen(): Promise<UnlistenFn> {
    try {
      return await listen<ForeignSession[]>(FOREIGN_EVENT, (event) => {
        this.ingest(event.payload);
      });
    } catch (err) {
      console.warn('usage://foreign listen failed; no live updates:', err);
      return () => {};
    }
  }

  /**
   * Convenience: seed with the initial app-session set then start listening,
   * returning the unlisten fn. The usual mount path; seeding first means the
   * initial set is in place before the first live push.
   */
  async start(appSessionIds: string[]): Promise<UnlistenFn> {
    await this.seed(appSessionIds);
    return this.listen();
  }
}

/** The Tauri event name the Rust foreign watcher emits the filtered list on. */
export const FOREIGN_EVENT = 'usage://foreign';

/** Singleton store, imported by the usage bar + the route. */
export const foreign = new ForeignStore();
