## Why

Follow-up to `perf-live-pane-polling`, covering the remaining findings of the
multi-agent performance review:

- Every agent's statusline tick (several per second while streaming) spawned up
  to eight `git` processes for data the app already polls itself.
- PTY output crossed the IPC boundary as a JSON array of numbers — about 3.7
  characters per byte to serialize, embed in the eval'd channel message, and
  parse in the webview — on the hottest path when several agents stream.
- `pty_write` performed a blocking write on the main thread while holding the
  pane registry lock, so one child that stopped draining its tty could freeze
  input to every pane.
- Nothing handled the window being hidden or the machine waking from sleep: all
  pollers kept their full rate while hidden, and on wake the fs-event backlog,
  every interval, and a remote fetch for every project (before the network was
  back) fired at once — the reported post-sleep sluggishness.

## What Changes

- **Statusline wrapper** reuses the git status in the pane's previous snapshot
  for a 10 s TTL (`checked_at`; `AGENT_DESKTOP_GIT_TTL_SECS` overrides, 0 = off).
- **PTY output frames are base64** (`{event:'data', b64}`), decoded in
  `ptyEvents.ts`.
- **PTY writes are queued** to a per-pane `pty-writer-*` thread that owns the
  writer. `pty_write` stays a sync command (keystroke order) but never blocks and
  never holds the registry lock during IO.
- **Subagents watcher** callback does no IO; a worker drains a 150 ms burst
  window and recomputes the union of touched sessions once.
- **Hidden / wake gating** (`pollGate.ts`, `appActivity.svelte.ts`): while hidden
  the visual polls pause and the correctness backstops run every 6th tick; a
  resume (visible again, or a detected wake) refreshes everything once, and the
  remote fetch waits 8 s after a wake for the network.

Not changed: the per-tool-call `event-hook.js` node start. Replacing it with a
shell one-liner would need a second implementation for Windows; deferred.

## Capabilities

### Modified Capabilities

- `terminal-core`: output frame encoding; queued, non-blocking input forwarding.
- `usage-dashboard`: snapshot git status reuse.
- `agent-overview`: burst-coalesced subagent recompute; hidden/wake poll gating.
