## Why

A paused agent kept its PTY (and its `claude` process) running, and every paused
agent was respawned on app launch. Paused agents are "deferred for later", so
with many of them the app paid for processes, polling, and terminal state the
user is not looking at — the same cost archived agents already avoid.

## What Changes

- **Pausing stops the process.** Pausing a resumable agent (claude-family program
  with a session id) terminates its PTY, like archiving; it stays in the Paused
  lane. Pausing a `working` agent asks for confirmation first. A pane that cannot
  be resumed (no session id) keeps running, as before.
- **Paused agents restore dormant.** On app launch a paused agent is not spawned.
- **Opening wakes it.** Opening (selecting / focusing) a dormant paused agent
  respawns it with `claude --resume`; it stays Paused until the user sends a new
  message (the existing auto-resume), or Resume is pressed.
- **Leaving puts it back to sleep.** A woken paused agent the user walks away from
  goes dormant again after the same grace period as an archived preview.
- Dormant panes leave every live poller (like archived ones), and orchestration
  refuses to message a dormant pane.

## Capabilities

### Modified Capabilities

- `agent-overview`: paused agents do not run until opened.

## Impact

`src/lib/layout/workspace.svelte.ts` (`dormant` runtime flag, `pauseAgent`,
`wakePaused`, `sleepPaused`, `resumeAgent`), `src/lib/layout/persistence.ts`,
`src/lib/layout/PaneNode.svelte`, `src/lib/overview/{paneRefs,roster,rosterInputs,inbox}.ts`,
`src/lib/overview/Inbox.svelte`, `src/lib/orchestration/executor.svelte.ts`.
`dormant` is runtime-only (never persisted; derived from `paused` at restore).
