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

  /** The ordered timeline for a pane (empty when none / not yet seeded). */
  timeline(paneId: string): AgentEvent[] {
    return this.byPane[paneId] ?? [];
  }

  /** The derived event activity (status + currentAction + question) for a pane. */
  activityFor(paneId: string): EventActivity {
    return deriveEventActivity(this.timeline(paneId));
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
    this.byPane[ev.paneId] = appendBounded(this.byPane[ev.paneId] ?? [], ev);
    this.onEvent?.(ev);
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
        if (clean.length > 0) {
          this.byPane[paneId] = clean;
          total += clean.length;
        }
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
