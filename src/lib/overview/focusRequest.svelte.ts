// An INBOUND, ONE-SHOT request to select a specific agent from OUTSIDE the inbox —
// today, a clicked needs-input desktop notification (capability `alert-click-focus`).
// The inbox owns agent selection as local state, so the always-mounted route can't
// call into it directly; it writes a request here and `Inbox.svelte` observes it,
// selects the agent through its existing `selectAgent`, and CONSUMES the request.
//
// Why a held request consumed on handle (rather than a nonce/baseline diff): the
// inbox is mounted ONLY in overview mode, but a click from grid view sets the request
// and THEN switches to overview — mounting the inbox FRESH in the same tick. A
// baseline captured at mount would already equal the just-issued request and swallow
// it (the agent would never get selected). Holding the request until the inbox
// consumes it makes delivery independent of mount timing; consuming it prevents a
// stale request from re-firing every time the inbox remounts (e.g. on a later
// overview⇄grid toggle). The mirror image of `focusAgent` (which flows the inbox's
// shown agent OUT to the route).

/** Reactive holder for a pending external "select this agent" request. */
export class FocusRequestStore {
  /** The requested agent's paneId, or null when there is no pending request. */
  paneId = $state<string | null>(null);

  /** Request that the inbox select `paneId`. Overwrites any still-pending request
   *  (the latest activation wins); a repeat request for the same agent re-fires
   *  because it is always consumed back to null between requests. */
  request(paneId: string): void {
    this.paneId = paneId;
  }

  /** Mark the pending request handled, so it does not re-fire on a later mount. */
  consume(): void {
    this.paneId = null;
  }
}

/** The singleton focus-request store: route writes, Inbox observes + consumes. */
export const focusRequest = new FocusRequestStore();
