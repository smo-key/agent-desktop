// The ONE shared agent roster (performance). The needs-input alerts driver (route,
// always mounted), the keep-awake driver, and the Inbox each used to run their own
// 1 s clock and rebuild the roster independently, so every tick derived the whole
// roster twice. This store owns a single clock and a single `$derived` roster that
// every consumer reads; `start()` is ref-counted so the clock runs while any
// consumer is mounted and stops when the last one leaves.
//
// The inputs are the same module singletons as before (snapshots, workspaces,
// runtime registry, transcript activity, event activity), so the rows are
// identical to what each consumer built for itself.

import { workspace } from '$lib/layout/workspace.svelte';
import { snapshots } from '$lib/usage/snapshots.svelte';
import { activity } from './activity.svelte';
import { events } from './events.svelte';
import { buildRoster, type AgentRow } from './roster';
import { toRosterWorkspaces } from './rosterInputs';
import { noteStatus, runtimeMap } from './runtime';

export class RosterStore {
  /** The roster's clock (epoch ms), ticking once a second while started. */
  nowMs = $state(Date.now());

  #starters = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  /** Roster-shaped workspaces; recomputed only when the workspaces change. */
  readonly workspaces = $derived(toRosterWorkspaces(workspace.workspaces));

  /** The agent rows, rebuilt on the clock and whenever any input changes. */
  readonly rows: AgentRow[] = $derived.by(() => {
    const rows = buildRoster(
      snapshots.byPane,
      this.workspaces,
      runtimeMap(),
      this.nowMs,
      activity.bySession,
      undefined,
      events.activityMap()
    );
    // Record each row's FINAL (post-override) status as the hysteresis memory for
    // the next derivation: a pane shown `working` holds In flight through a brief
    // silence instead of bouncing to `waiting` (see deriveStatus / IDLE_GRACE_MS).
    // The runtime registry is non-reactive, so this write never retriggers the
    // derivation; `rowFor` reads the value recorded on the previous tick.
    for (const r of rows) noteStatus(r.paneId, r.status);
    return rows;
  });

  /**
   * Start the clock for one consumer; returns the matching stop. Ref-counted:
   * the interval is created by the first starter and cleared by the last stop.
   */
  start(): () => void {
    this.#starters++;
    if (this.#timer === null) {
      this.nowMs = Date.now();
      this.#timer = setInterval(() => (this.nowMs = Date.now()), 1000);
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.#starters--;
      if (this.#starters <= 0 && this.#timer !== null) {
        clearInterval(this.#timer);
        this.#timer = null;
        this.#starters = 0;
      }
    };
  }

  /** Whether the clock is currently running (tests). */
  get running(): boolean {
    return this.#timer !== null;
  }
}

/** Singleton, read by the route's drivers and the Inbox. */
export const roster = new RosterStore();
