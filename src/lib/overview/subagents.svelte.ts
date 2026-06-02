// Runes store for SUBAGENTS surfaced under each app agent in the overview (Stage 3
// of agent-overview; spec: Surface Subagents). Stage 2 supplies the data: the Rust
// `subagents_for(sessions)` command returns a `sessionId -> Subagent[]` map by
// resolving each session's Claude project dir from its cwd, and the
// `overview://subagents` event re-emits that map (coalesced) whenever anything
// under `~/.claude/projects/` changes for the watched sessions.
//
// This store SEEDS via the command with the app's current session refs (each app
// pane's Claude `session_id` + its cwd), keeps that watched-set current as the
// app's pane set changes, and applies each live push. The Overview reads
// `bySession` to nest a parent agent's subagents under its card, and
// `usageList` to feed Stage 1's `aggregate(...)` (the subagent-usage source).
//
// Tolerant by construction: a non-object/array payload is ignored (keeps the last
// map), and the Rust side already skips malformed records — so partial subagent
// metadata never breaks the roster. Mirrors `foreign.svelte.ts`'s command+event
// shape so the route wires it the same way.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** One subagent's recorded usage — the Stage 2 wire shape (camelCase). Every
 *  field is optional; the whole object is `null` when nothing was recorded. */
export interface SubagentUsage {
  /** Cost in USD, or null/absent when not recorded. */
  cost?: number | null;
  /** Total tokens consumed, or absent. */
  tokens?: number | null;
  /** Context-window usage 0..100, or absent. */
  contextPct?: number | null;
}

/**
 * One subagent surfaced under its parent agent — the Stage 2 `Subagent` wire shape
 * (serialized camelCase). `id` + `parentSession` are always present; the rest is
 * best-effort and may be null when the source record omits it.
 */
export interface Subagent {
  /** The subagent agent id (matches the `agent-<id>` sidecars). */
  id: string;
  /** Human label (e.g. `spec:terminal-core`), or null. */
  label?: string | null;
  /** Lifecycle state verbatim (`done`/`running`/…), or null. */
  status?: string | null;
  /** The model the subagent ran on, or null. */
  model?: string | null;
  /** Recorded usage, or null when nothing was recorded. */
  usage?: SubagentUsage | null;
  /** The parent session id this subagent was spawned under. */
  parentSession: string;
  /** The workflow run id this subagent belongs to, or null. */
  workflowId?: string | null;
}

/** One session the store asks subagents for: its Claude session id + its cwd. The
 *  command needs the cwd to locate the project dir; a session with no cwd is
 *  skipped server-side (absent from the map). */
export interface SessionRef {
  /** The Claude session id (the map key). */
  sessionId: string;
  /** The session's absolute working directory, or null (then it's skipped). */
  cwd: string | null;
}

/** The whole store state: sessionId -> that session's subagents. */
export type SubagentMap = Record<string, Subagent[]>;

/**
 * Whether `value` is a usable subagent: an object with a non-empty string `id`.
 * The Rust side already dropped records with neither id nor label, but a future
 * malformed emit must never poison the map or throw.
 */
function isSubagent(value: unknown): value is Subagent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id.length > 0
  );
}

/**
 * PURE: normalize a raw `sessionId -> Subagent[]` payload (from the command or an
 * event) into a clean `SubagentMap`, dropping any non-array session value and any
 * malformed subagent within it. A non-object payload yields an empty map. Never
 * mutates its input. This is the unit-tested core of the store.
 */
export function normalizeSubagents(payload: unknown): SubagentMap {
  const out: SubagentMap = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const [sessionId, list] of Object.entries(payload as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[sessionId] = list.filter(isSubagent);
  }
  return out;
}

/**
 * PURE: flatten the per-session map into one subagent list — used to seed Stage
 * 1's `aggregate(...)`, which sums each available subagent's recorded cost. Order
 * is by session id then the in-record order, for a stable result.
 */
export function flattenSubagents(map: SubagentMap): Subagent[] {
  const out: Subagent[] = [];
  for (const sessionId of Object.keys(map).sort()) {
    for (const s of map[sessionId]) out.push(s);
  }
  return out;
}

/**
 * Reactive subagents store. Holds the `sessionId -> Subagent[]` map in `$state`,
 * seeded from `subagents_for` and updated on each `overview://subagents` event.
 */
export class SubagentsStore {
  /** The live sessionId -> subagents map. Deep-reactive via the runes proxy. */
  bySession = $state<SubagentMap>({});

  /** The subagents for a parent session id (empty when none / not yet seeded). */
  forSession(sessionId: string): Subagent[] {
    return this.bySession[sessionId] ?? [];
  }

  /** Every subagent across all sessions, flattened (for the usage aggregate). */
  get usageList(): Subagent[] {
    return flattenSubagents(this.bySession);
  }

  /** Apply one (possibly malformed) payload as the new map, normalized. A non-object
   *  payload yields an empty map; callers pass real maps so this is safe. */
  ingest(payload: unknown): void {
    this.bySession = normalizeSubagents(payload);
  }

  /**
   * Seed (and re-seed) from the `subagents_for(sessions)` command: pushes the
   * watched-set to the Rust watcher AND returns the freshly-computed map, which we
   * store. Call on mount and whenever the app's app-pane session set changes. On
   * failure (e.g. outside Tauri) it logs once and leaves the map untouched.
   *
   * @param sessions the app's app-pane session refs ({sessionId, cwd})
   */
  async seed(sessions: SessionRef[]): Promise<number> {
    try {
      const map = await invoke<SubagentMap>('subagents_for', { sessions });
      this.bySession = normalizeSubagents(map);
      return Object.keys(this.bySession).length;
    } catch (err) {
      console.warn('subagents_for seed failed; starting empty:', err);
      return 0;
    }
  }

  /**
   * Subscribe to live `overview://subagents` pushes, ingesting each map. Returns an
   * unlisten function the caller invokes on teardown. On failure (outside Tauri)
   * resolves to a no-op unlisten so callers needn't special-case it.
   */
  async listen(): Promise<UnlistenFn> {
    try {
      return await listen<SubagentMap>(SUBAGENTS_EVENT, (event) => {
        this.ingest(event.payload);
      });
    } catch (err) {
      console.warn('overview://subagents listen failed; no live updates:', err);
      return () => {};
    }
  }

  /**
   * Convenience: seed with the initial session set then start listening, returning
   * the unlisten fn. The usual mount path; seeding first means the initial map is
   * in place before the first live push.
   */
  async start(sessions: SessionRef[]): Promise<UnlistenFn> {
    await this.seed(sessions);
    return this.listen();
  }
}

/** The Tauri event name the Rust subagents watcher emits the per-session map on. */
export const SUBAGENTS_EVENT = 'overview://subagents';

/** Singleton store, imported by the Overview + the route. */
export const subagents = new SubagentsStore();
