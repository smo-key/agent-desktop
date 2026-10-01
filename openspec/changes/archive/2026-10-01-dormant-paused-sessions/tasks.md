## 1. Store + persistence

- [x] 1.1 `PaneSession.dormant` (runtime-only); `pauseAgent` sets dormant + resume for a resumable pane; `wakePaused` / `sleepPaused`; `resumeAgent` clears dormant
- [x] 1.2 Restore: a paused resumable pane restores dormant; serialization never writes `dormant`
- [x] 1.3 `isLivePane` excludes dormant panes

## 2. UI + orchestration

- [x] 2.1 `PaneNode`: no TerminalPane (and no TaskBadge) for a dormant pane
- [x] 2.2 Roster rows carry `dormant`; Inbox wakes a dormant paused agent when it is opened (row click / focus), shows a paused placeholder otherwise
- [x] 2.3 Grace timer: woken paused agents not shown go dormant after `PREVIEW_GRACE_MS` (pure `graceTargets`)
- [x] 2.4 `pauseWorkingConfirm` before pausing a working agent
- [x] 2.5 Orchestration `send` refuses a dormant pane

## 3. Verify

- [x] 3.1 `yarn check`, `yarn test`, `yarn coverage` green; `openspec validate dormant-paused-sessions`

## 4. Adversarial review follow-ups

- [x] 4.1 CRITICAL: pausing an EMPTY session keeps it running (`pauseAgent(…, stopProcess)`; `--resume` of a never-written transcript fails)
- [x] 4.2 `closeAgent` drops `dormant`, so preview / restore / `unarchive_agent` of an archived ex-paused agent spawns
- [x] 4.3 A dormant pane reports `idle` (roster + orchestration), not the stale pre-pause `working`
- [x] 4.4 Grid-view "Session paused" placeholder gets an Open button
- [x] 4.5 `wakePaused` marks `dormant:false`; only woken panes are grace targets (no no-op timer for non-resumable paused panes)
- [x] 4.6 Accepted (WARNING): a message sent < one poll before pausing can make the first post-open poll auto-resume the agent (pre-existing baseline race, now visible on open)
- [x] 4.7 Accepted (WARNING): wake-on-focus and walk-away sleep run only in the Inbox view; a woken paused agent left in grid view keeps running until the Inbox is shown
- [x] 4.8 Restore makes a paused pane dormant only when its baseline count is a positive number (an empty / unknown session may have no transcript to resume)
- [x] 4.9 The walk-away grace never puts a WORKING woken agent to sleep
- [x] 4.10 Accepted (WARNING): a session judged empty at pause time (first message sent < one poll earlier) keeps running until restart
