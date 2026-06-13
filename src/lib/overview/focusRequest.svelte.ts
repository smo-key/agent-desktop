// An INBOUND request to select a specific agent, coming from OUTSIDE the inbox —
// today, a clicked needs-input desktop notification (capability
// `alert-click-focus`). The inbox owns agent selection as local state, so the
// always-mounted route can't call into it directly; instead it writes a request
// here and `Inbox.svelte` observes it and routes through its existing
// `selectAgent`. This is the mirror image of `focusAgent` (which flows the inbox's
// shown agent OUT to the route) — kept as a one-field singleton so neither side
// reaches into the other's internals.
//
// The `nonce` makes each request distinct even when it names the agent already
// shown, so a repeat notification click re-focuses that agent's terminal rather
// than being swallowed as "no change".

/** Reactive holder for an external "select this agent" request. */
export class FocusRequestStore {
  /** The requested agent's paneId, or null when nothing has been requested. */
  paneId = $state<string | null>(null);
  /** Bumped on every request so re-requesting the same agent still triggers. */
  nonce = $state(0);

  /** Request that the inbox select `paneId`. Idempotent only up to the nonce. */
  request(paneId: string): void {
    this.paneId = paneId;
    this.nonce += 1;
  }
}

/** The singleton focus-request store: route writes, Inbox observes. */
export const focusRequest = new FocusRequestStore();
