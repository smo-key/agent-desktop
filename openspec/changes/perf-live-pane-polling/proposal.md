## Why

With many agent windows open — and especially after hours of use — the app's
own host process sat at ~57% CPU and the webview at ~25%, and responsiveness
degraded over time. A live sample put a quarter of the host's time inside the
subagents watcher recompute. Three compounding causes, all of which grow with
every session ever opened:

- Every registry pane (138 in the measured layout, 128 of them **closed**) sat
  in every polling set: the transcript activity poll, the event re-seed, title
  generation, and the subagents watched-set. A closed agent has no process and
  no changing files, so this was pure waste.
- The subagents watcher (a recursive watch over `~/.claude/projects`, 588 MB)
  recomputed **every** watched session on **every** file change anywhere in the
  tree, reading a 1 MiB tail of each parent transcript and JSON-parsing every
  subagent transcript in full (242 MB on this machine) just for two timestamps.
- The activity / events / subagents / snapshot commands ran synchronously on the
  main thread, re-reading files that had not changed, and the roster was rebuilt
  twice a second (alerts driver + Inbox) from freshly re-derived inputs.

## What Changes

- **Only live agents are polled.** Closed (archived) panes leave every clocked
  poller and the subagents watched-set; they are still primed once at mount so an
  archived row keeps its last summary. Restoring/previewing an archived agent
  clears `closed`, so it rejoins the live set at once.
- **Incremental subagents watcher.** A fs event recomputes only the session(s)
  its paths belong to, patching a shared map; a change elsewhere costs no IO.
  Subagent transcript spans read a bounded 64 KiB head + tail and are cached by
  size+mtime.
- **Caches and async commands.** `events_for` serves sink reads and transcript
  backfills, and `activity_for` serves transcript summaries, from size+mtime
  caches; `activity_for` / `events_for` / `subagents_for` / `usage_snapshots` run
  off the main thread.
- **Memoized derivations, one roster.** The event store memoizes per-pane
  activity on timeline identity and skips an unchanged re-seed; the activity
  store merges per pane and keeps unchanged objects; one shared, ref-counted
  1 s clock and one derived roster serve the alerts driver, the keep-awake
  driver, and the Inbox. The status hysteresis memo now runs with that shared
  roster (so it applies in grid view too).

## Capabilities

### Modified Capabilities

- `agent-overview`: polling and subagent discovery are bounded to live agents;
  one shared roster derivation.
- `activity-timeline`: reconciliation reads are cached and change-skipping.
