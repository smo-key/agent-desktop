// SHARED reactive store for the per-project COORDINATOR's explicit "needs input"
// signal (add-agent-specialists, tasks 10.11–10.12).
//
// The coordinator's default idle/waiting heuristic must NOT flag it as needing the
// user (it is expected to keep working/delegating). It surfaces "needs you" ONLY
// when it genuinely needs the user — either it asks via the built-in AskUserQuestion
// tool (detected from activity, NOT this store), OR it explicitly calls the
// `request_user_input` orchestration tool. THIS store carries that explicit signal:
// the executor SETS the flag for a coordinator pane when `request_user_input` fires,
// the roster READS it to mark that coordinator as needing input.
//
// CLEAR trigger (documented, simplest robust choice): the flag is cleared the moment
// the coordinator RESUMES — its effective status becomes `working` again — which is
// exactly what happens once the user delivers input and the coordinator starts the
// next turn. The roster passes each coordinator's freshly-derived status to
// `clearOnWorking` every render tick, so a stale flag never lingers after the
// coordinator gets going. The executor also OVERWRITES (refreshes) the flag if the
// coordinator calls `request_user_input` again.
//
// Reactive: backed by a `$state` Map so reads inside `$derived`/`$effect` (the
// roster) re-run when the executor mutates it. Framework-coupled (runes), hence the
// `.svelte.ts` extension; the pure decision lives in `roster.ts` and is unit-tested
// there without this store.

import type { AgentStatus } from '../overview/roster';

/** The explicit needs-input signal for one coordinator pane. */
export interface CoordinatorNeedsInput {
  /** A short reason/prompt the coordinator passed (why it needs you), or null. */
  message: string | null;
}

/** Reactive coordinator-paneId → needs-input signal. */
class CoordinatorNeedsInputStore {
  private map = $state<Record<string, CoordinatorNeedsInput>>({});

  /** SET (or refresh) the flag for a coordinator pane, with an optional message. */
  set(paneId: string, message?: string | null): void {
    this.map = { ...this.map, [paneId]: { message: message?.trim() ? message.trim() : null } };
  }

  /** CLEAR the flag for a coordinator pane (no-op when unset). */
  clear(paneId: string): void {
    if (!(paneId in this.map)) return;
    const next = { ...this.map };
    delete next[paneId];
    this.map = next;
  }

  /** The flag for a pane, or null when unset. */
  get(paneId: string): CoordinatorNeedsInput | null {
    return this.map[paneId] ?? null;
  }

  /** Whether the flag is set for a pane. */
  has(paneId: string): boolean {
    return paneId in this.map;
  }

  /**
   * The current flag map (paneId → signal). Drives the roster's per-coordinator
   * needs-input read; reactive so the roster re-derives on set/clear.
   */
  all(): Readonly<Record<string, CoordinatorNeedsInput>> {
    return this.map;
  }

  /**
   * Clear the flag if the coordinator has resumed (its effective status is now
   * `working`). The documented CLEAR trigger — called by the roster each tick with a
   * coordinator's freshly-derived status, so the flag never outlives the coordinator
   * getting back to work. Returns true when it cleared.
   */
  clearOnWorking(paneId: string, status: AgentStatus): boolean {
    if (status === 'working' && this.has(paneId)) {
      this.clear(paneId);
      return true;
    }
    return false;
  }
}

/** The singleton coordinator needs-input store. */
export const coordinatorNeedsInput = new CoordinatorNeedsInputStore();
