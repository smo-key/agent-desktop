// The agent the user is currently "viewing" in the inbox — the focus pane's agent.
// Published by `Inbox.svelte` (which owns that selection as local state) and read by
// the always-mounted alert driver in `+page.svelte` to resolve the `viewedPaneId`
// for the `agent-unfocused` alert mode in OVERVIEW mode (grid mode reads
// `workspace.focusedId` directly). Kept as a one-field singleton so the route does
// not need to reach into the Inbox's internals.

/** Reactive holder for the inbox's currently-shown agent paneId. */
export class FocusAgentStore {
  /** The shown agent's paneId, or null when the inbox shows nothing / is unmounted. */
  paneId = $state<string | null>(null);
}

/** The singleton focus-agent store. */
export const focusAgent = new FocusAgentStore();
