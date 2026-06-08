# Bootstrap the usage dashboard's rate limits at startup

## Why

Account-wide rate limits (`rate_limits`) only appear in a *live* Claude session's
statusline snapshot. The dashboard's rollup reads them from the newest snapshot,
so on a fresh launch with no session open the 5h/7d bars render in their
empty/unavailable state until the user happens to start a session. The account
limits are knowable at launch — the app just needs one session to render its
statusline once.

## What changes

On app startup the backend spawns a **hidden** `claude` TUI session wired *only*
into the snapshot pipeline (statusline wrapper + `AGENT_DESKTOP_SNAPSHOT_DIR` +
`AGENT_DESKTOP_PANE`), so its first statusline render captures the account
`rate_limits` into a snapshot the watcher picks up. The session has no UI pane —
its output is discarded — and it is killed after a bounded 30s TTL. It is
deliberately **not** wired into the event-hook lifecycle, so it never appears in
the overview's event timeline or subagents. The whole thing is best-effort: a
failure to resolve the usage paths or spawn is logged and ignored.

Two robustness details came out of the adversarial review:

- **No stale window on cold start.** A prior launch's `snapshots/usage-bootstrap.json`
  is deleted before the frontend seeds from disk, so the dashboard never briefly
  shows an already-expired rate-limit window; the fresh probe re-creates the file
  within the TTL.
- **TTL is never silently void.** If the kill-timer thread fails to spawn, the probe
  is killed immediately (an interactive `claude` TUI never exits on its own), so a
  hidden session can't leak for the whole app lifetime.

Capability touched: `usage-dashboard` (one ADDED requirement).
