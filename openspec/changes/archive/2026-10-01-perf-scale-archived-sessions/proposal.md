## Why

With many sessions accumulated (148 workspaces in the measured layout, 137 of
them archived) the app becomes very slow after some time of use, approaching a
freeze, while agents keep running. macOS logged `cpu_resource` reports for the
host (63% average CPU over 143 s), dominated by JSON parsing of transcripts.
`perf-live-pane-polling` / `perf-io-and-wake` removed archived panes from the
pollers, but several costs still scale with the number of sessions ever opened,
with transcript length, or with event rate:

- `ourSessionIds` is a `$derived` array rebuilt on every statusline snapshot, so
  each snapshot (several per second per streaming agent) re-ran both the
  `subagents_for` and `events_for` re-seeds over IPC, and the worktree-adopt
  effect scanned every registry per snapshot.
- `activity_for` re-read and JSON-parsed the WHOLE transcript (up to 44 MB) to
  count user messages whenever it changed, and every hook event from any agent
  fired a refresh over all live panes with no debounce or single-flight.
- `events_for` returned a session's entire durable sink (tens of thousands of
  events, MBs of JSON) for any pane whose ring is empty — every 5 s re-seed.
- The 1 s roster clock rebuilt every row (archived included) as new objects, so
  every Inbox derivation/effect re-ran each second; lane ordering did an
  `indexOf` over a deep-proxied array inside the sort comparator; every
  PaneNode (148) ran `find` over all workspaces; every archived pane mounted a
  1 s TaskBadge timer.
- The subagents recompute JSON-parsed every line of a 1 MiB parent-transcript
  tail per burst, and `session_focus` read whole transcripts on an async worker.

## What Changes

- **Stable session-set key.** Re-seeds key on a joined session-id string, so a
  snapshot that does not change the set re-seeds nothing; the adopt effect uses
  an O(1) pane→session index.
- **Incremental transcript reads.** The user-message count is cached per file by
  byte offset and only appended bytes are parsed (reset when the file shrinks);
  only candidate lines are JSON-parsed. The sink read returns at most the ring
  capacity tail. The subagent parent-tool scan skips lines without tool blocks.
  `session_focus` transcript reads run on the blocking pool.
- **Coalesced activity refresh.** Hook-event-driven `refreshActivity` is
  debounced and single-flight.
- **Bounded roster churn.** Unchanged roster rows keep their object identity
  across ticks; lane order uses a precomputed rank map; workspace lookups use a
  derived id index; archived panes mount no TaskBadge.

## Capabilities

### Modified Capabilities

- `agent-overview`: re-seed/adopt work scales with the live session set, not with
  snapshot rate or registry size; roster rows are identity-stable.
- `activity-timeline`: transcript and sink reads are incremental/bounded; the
  event-driven activity refresh is coalesced.

## Impact

`src/routes/+page.svelte`, `src/lib/layout/workspace.svelte.ts`,
`src/lib/layout/PaneNode.svelte`, `src/lib/overview/roster.ts`,
`src-tauri/src/activity.rs`, `src-tauri/src/events.rs`,
`src-tauri/src/subagents.rs`, `src-tauri/src/lib.rs`. No user-visible behavior
change other than responsiveness.
