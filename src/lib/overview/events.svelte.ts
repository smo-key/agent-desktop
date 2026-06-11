// Runes store for the event-sourced ACTIVITY TIMELINE surfaced on each agent.
//
// The backend (events.rs) hosts a Unix socket every app-launched session's event
// hook delivers to, and pushes each parsed event to the frontend over the
// `overview://event` Tauri event. This store accumulates them per pane (a bounded
// ring, mirroring the Rust hot cache) and SEEDS from the `events_for` command on
// mount/resume — so a `claude --resume` shows its prior timeline immediately,
// before any new live event arrives.
//
// It exposes, per pane: the ordered timeline (for the expandable activity panel)
// and the derived `EventActivity` (status + currentAction + pending question) the
// roster prefers over the PTY-byte heuristic. Keyed by `paneId` so a roster row
// resolves its activity directly.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  appendBounded,
  deriveEventActivity,
  impliesEverPrompted,
  type AgentEvent,
  type EventActivity
} from './events';
import type { PaneRef } from './activity.svelte';

/** The Tauri event name the backend emits each parsed event on. */
export const EVENT_EVENT = 'overview://event';

/** The whole store state: paneId -> that pane's ordered event timeline. */
export type EventMap = Record<string, AgentEvent[]>;

/** Whether `value` is a usable event object with the structural minimum. */
function isEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.paneId === 'string' &&
    r.paneId.length > 0 &&
    typeof r.hookEventName === 'string' &&
    r.hookEventName.length > 0
  );
}

/**
 * Reactive event store. Holds the `paneId -> AgentEvent[]` timeline in `$state`,
 * fed live by the `overview://event` listener and seeded by `events_for`.
 */
export class EventStore {
  /** The live paneId -> ordered timeline map. Deep-reactive via the runes proxy. */
  byPane = $state<EventMap>({});

  /**
   * Optional side-effect hook invoked (non-reactively) for each ingested live
   * event, AFTER it is stored. The route sets this to trigger an event-driven
   * transcript read (see `poll.ts`) on a tool completing / a turn ending.
   */
  onEvent?: (ev: AgentEvent) => void;

  /**
   * Sticky per-pane "has ever begun a turn" latch. The bounded ring (`appendBounded`,
   * `EVENT_RING_CAP`) drops the OLDEST events, so a single long turn (>cap events) can
   * EVICT the original `UserPromptSubmit`. Recomputing `everPrompted` from the ring
   * alone would then report `false` and wrongly flip a busy coordinator into the
   * Needs-you lane. We set this latch the moment ANY turn activity is ingested or seeded
   * (a prompt, or any tool/Stop event that PROVES a turn ran — see `impliesEverPrompted`)
   * and NEVER clear it, so the signal survives ring eviction. Keyed by paneId. Not
   * `$state`: every mutation accompanies a `byPane` mutation, whose reactivity already
   * re-runs `activityFor`/`activityMap`. */
  private everPromptedPanes = new Set<string>();

  /** The ordered timeline for a pane (empty when none / not yet seeded). */
  timeline(paneId: string): AgentEvent[] {
    return this.byPane[paneId] ?? [];
  }

  /** The derived event activity (status + currentAction + question) for a pane. The
   *  sticky `everPrompted` latch is overlaid so it survives ring eviction (see above). */
  activityFor(paneId: string): EventActivity {
    return deriveEventActivity(this.timeline(paneId), this.everPromptedPanes.has(paneId));
  }

  /** The derived `paneId -> EventActivity` map for every pane with events, for the
   *  roster (`buildRoster`'s `eventActivity` argument). */
  activityMap(): Record<string, EventActivity> {
    const out: Record<string, EventActivity> = {};
    for (const paneId of Object.keys(this.byPane)) out[paneId] = this.activityFor(paneId);
    return out;
  }

  /** Ingest one live event, appending it to its pane's bounded ring, then firing
   *  the optional `onEvent` side-effect hook. */
  ingest(ev: AgentEvent): void {
    if (impliesEverPrompted(ev)) this.everPromptedPanes.add(ev.paneId);
    this.byPane[ev.paneId] = appendBounded(this.byPane[ev.paneId] ?? [], ev);
    this.onEvent?.(ev);
  }

  /**
   * Record a user INTERRUPT (Esc) for a pane. Interrupting aborts the in-flight tool,
   * but claude fires NO `PostToolUse` for the aborted tool (and no `Stop`), so the
   * event-sourced status would stay pinned at `working` indefinitely. When the pane is
   * currently `working`, append a synthetic turn-end (`Stop`) so `deriveEventActivity`
   * clears the in-flight tool and the row returns to `waiting` (Needs-input).
   *
   * A no-op unless the pane is actually working — a stray Esc at the idle prompt (or on
   * a non-claude pane, which never has a `working` event status) adds no timeline noise.
   * The synthetic event is frontend-only (not delivered to the durable sink); a later
   * real event simply appends after it.
   */
  markInterrupt(paneId: string): void {
    if (this.activityFor(paneId).status !== 'working') return;
    const prior = this.timeline(paneId);
    const ts = prior.length > 0 ? prior[prior.length - 1].ts : 0;
    // `synthetic: true` marks this as a frontend-only interrupt turn-end (not a real
    // hook event): it clears the in-flight tool so the row shows Needs-input, but
    // consumers like task auto-archive must NOT read it as a genuine "returned to user".
    this.ingest({ paneId, sessionId: '', hookEventName: 'Stop', ts, synthetic: true });
  }

  /**
   * Seed timelines from the `events_for(panes)` command (ring → durable sink →
   * transcript backfill, resolved in Rust) for the given app panes. Called on
   * mount/resume; merges into the live map (a pane absent from the result keeps
   * whatever it already has). On failure (e.g. outside Tauri) it logs once.
   */
  async seed(panes: PaneRef[]): Promise<number> {
    try {
      const map = await invoke<EventMap>('events_for', { panes });
      let total = 0;
      for (const [paneId, events] of Object.entries(map)) {
        const clean = Array.isArray(events) ? events.filter(isEvent) : [];
        if (clean.length === 0) continue; // nothing authoritative to seed; keep existing
        // Latch everPrompted from seeded history too, so a resume of a long-running
        // session keeps a busy coordinator out of the Needs-you lane even when the
        // seeded slice no longer contains the original prompt (only later turn activity).
        if (clean.some(impliesEverPrompted)) this.everPromptedPanes.add(paneId);
        // MERGE rather than overwrite. `clean` is authoritative for real events up to its
        // last `ts`, but the live map may already hold things the snapshot can't reproduce:
        // a frontend-only synthetic interrupt Stop, and live events that landed AFTER the
        // snapshot was taken (newer `ts`). A wholesale overwrite would clobber the synthetic
        // Stop (re-pinning an interrupted pane to `working`) or drop an in-flight live event.
        // Preserve exactly those, appended after the snapshot in their existing order —
        // events already in `clean` have `ts <= snapshotLastTs`, so they are never
        // duplicated, and this keeps a (sink-empty + transcript) backfill from being lost
        // when a live event raced ahead of this seed.
        const existing = this.byPane[paneId] ?? [];
        const snapshotLastTs = clean[clean.length - 1].ts;
        const preserved = existing.filter((e) => e.synthetic === true || e.ts > snapshotLastTs);
        this.byPane[paneId] = preserved.length > 0 ? [...clean, ...preserved] : clean;
        total += clean.length;
      }
      return total;
    } catch (err) {
      console.warn('events_for failed; no seeded timeline:', err);
      return 0;
    }
  }

  /**
   * Start listening for live `overview://event` pushes, ingesting each. Returns
   * an unlisten function the caller invokes on teardown. Outside Tauri (no
   * backend) it logs once and returns a no-op unlisten.
   */
  async listen(): Promise<UnlistenFn> {
    try {
      return await listen<AgentEvent>(EVENT_EVENT, (event) => {
        if (isEvent(event.payload)) this.ingest(event.payload);
      });
    } catch (err) {
      console.warn('overview://event listen failed; no live timeline:', err);
      return () => {};
    }
  }

  /** Convenience: seed then start listening, returning the unlisten fn. */
  async start(panes: PaneRef[]): Promise<UnlistenFn> {
    await this.seed(panes);
    return this.listen();
  }
}

/** Singleton store, imported by the overviews + the route. */
export const events = new EventStore();
