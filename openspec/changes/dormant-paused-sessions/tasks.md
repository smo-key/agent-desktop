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
