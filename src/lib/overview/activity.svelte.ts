// Runes store for live TRANSCRIPT ACTIVITY surfaced on each agent in the overview.
//
// The statusline-driven snapshot is an unreliable data source (it depends on a
// node statusline command running in the spawned env, and Claude only re-renders
// it sporadically — never while blocked on an AskUserQuestion). So this data comes
// straight from the session TRANSCRIPT instead: the Rust `activity_for(panes)`
// command returns a `paneId -> {summary, question, contextPct}` map by reading
// each pane's EXACT `~/.claude/projects/<cwd>/<sessionId>.jsonl` (the app spawns
// claude with `--session-id`, so two agents in one folder never cross-contaminate).
//
// Prerequisite: the agent must write a FULL local transcript. The spawn override
// injects `remoteControlAtStartup: false` (see usage/spawn.ts) precisely because
// the user's global default hands the session to the cloud Remote-Control bridge,
// which leaves only a STUB local transcript (a `bridge-session` marker — no
// assistant turns / AskUserQuestion / usage), starving everything below.
//
// The store is POLLED (the route re-seeds every ~1.5s from the current app panes),
// which is simple and reliable; a question appears within a second or two of the
// agent asking it. Keyed by `paneId` so the roster resolves a row's activity
// directly, with no dependency on the snapshot's session id.

import { invoke } from '@tauri-apps/api/core';
import type { PendingQuestion, QuestionOption } from './roster';

/** One app pane the store asks activity for. */
export interface PaneRef {
  /** The frontend pane id (the activity map key, matches the roster row). */
  paneId: string;
  /** The app-owned Claude session id — its exact transcript (`<id>.jsonl`). */
  sessionId: string;
  /** The pane's absolute working directory (a fast-path hint), or null. */
  cwd: string | null;
}

/** A session's high-level activity, derived from its transcript. */
export interface Activity {
  /** The agent's last assistant message ("what it just said"), or null. */
  summary?: string | null;
  /** A pending AskUserQuestion the agent is waiting on (compact text), or null. */
  question?: string | null;
  /** The full structured pending question(s) — options the user can answer, or null. */
  questions?: PendingQuestion[] | null;
  /** Context-window usage 0..100 (from the transcript's token usage), or null. */
  contextPct?: number | null;
  /** Recent assistant messages (newest LAST), rendered as the transcript preview. */
  messages?: string[] | null;
  /** A cheap hash of the user's messages — changes only when the user adds one;
   *  gates session-title regeneration. */
  userHash?: string | null;
}

/** The whole store state: paneId -> that pane's activity. */
export type ActivityMap = Record<string, Activity>;

/** Whether `value` is a usable activity object (a plain object). */
function isActivity(value: unknown): value is Activity {
  return typeof value === 'object' && value !== null;
}

/** PURE: coerce a raw value into a clean `PendingQuestion[]`, or null. Drops any
 *  malformed entry; a question with no prompt text is skipped. */
function normalizeQuestions(value: unknown): PendingQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const out: PendingQuestion[] = [];
  for (const q of value) {
    if (!q || typeof q !== 'object') continue;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== 'string' || r.question.length === 0) continue;
    const options: QuestionOption[] = Array.isArray(r.options)
      ? (r.options as unknown[])
          .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
          .filter((o) => typeof o.label === 'string' && (o.label as string).length > 0)
          .map((o) => ({
            label: o.label as string,
            description: typeof o.description === 'string' ? (o.description as string) : ''
          }))
      : [];
    out.push({
      header: typeof r.header === 'string' ? r.header : '',
      question: r.question,
      multiSelect: r.multiSelect === true,
      options
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * PURE: normalize a raw `paneId -> Activity` payload into a clean `ActivityMap`,
 * coercing each entry's fields and dropping any non-object value. A non-object
 * payload yields an empty map. Unit-tested core of the store.
 */
export function normalizeActivity(payload: unknown): ActivityMap {
  const out: ActivityMap = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const [paneId, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!isActivity(value)) continue;
    out[paneId] = {
      summary: typeof value.summary === 'string' ? value.summary : null,
      question: typeof value.question === 'string' ? value.question : null,
      questions: normalizeQuestions((value as Record<string, unknown>).questions),
      contextPct:
        typeof value.contextPct === 'number' && Number.isFinite(value.contextPct)
          ? value.contextPct
          : null,
      messages: Array.isArray((value as Record<string, unknown>).messages)
        ? ((value as { messages: unknown[] }).messages.filter((m) => typeof m === 'string') as string[])
        : null,
      userHash:
        typeof (value as Record<string, unknown>).userHash === 'string'
          ? ((value as { userHash: string }).userHash)
          : null
    };
  }
  return out;
}

/**
 * Reactive activity store. Holds the `paneId -> Activity` map in `$state`,
 * refreshed by polling the `activity_for` command from the route's clock.
 */
export class ActivityStore {
  /** The live paneId -> activity map. Deep-reactive via the runes proxy. */
  bySession = $state<ActivityMap>({});

  /** The activity for a pane id (empty object when none / not yet seeded). */
  forPane(paneId: string): Activity {
    return this.bySession[paneId] ?? {};
  }

  /**
   * Refresh from the `activity_for(panes)` command for the given app panes and
   * store the result. Called on mount and on the route's poll clock. A no-op
   * reactive write when nothing changed (the runes proxy diffs structurally on
   * assignment). On failure (e.g. outside Tauri) it logs once and leaves the map.
   */
  async refresh(panes: PaneRef[]): Promise<number> {
    try {
      const map = await invoke<ActivityMap>('activity_for', { panes });
      this.bySession = normalizeActivity(map);
      return Object.keys(this.bySession).length;
    } catch (err) {
      console.warn('activity_for failed; no transcript activity:', err);
      return 0;
    }
  }
}

/** Singleton store, imported by the overviews + the route. */
export const activity = new ActivityStore();
