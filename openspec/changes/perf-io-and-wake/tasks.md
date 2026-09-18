## 1. Rust

- [x] 1.1 `PtyEvent::Data` serializes its bytes as base64 (`b64`)
- [x] 1.2 Per-pane `pty-writer-*` thread + ordered queue; `PtyManager::write` enqueues outside the registry lock
- [x] 1.3 Subagents watcher: IO-free notify callback + burst-coalescing recompute worker

## 2. Frontend / resources

- [x] 2.1 `ptyEvents.ts` decoder; `TerminalPane` consumes `b64` frames
- [x] 2.2 Statusline wrapper reuses the previous snapshot's git status within a TTL
- [x] 2.3 `pollGate.ts` policy + `appActivity.svelte.ts` (visibility, wake detection, resumes)
- [x] 2.4 Route pollers gated while hidden; one refresh on resume; post-wake fetch hold

## 3. Specs

- [x] 3.1 Deltas for `terminal-core`, `usage-dashboard`, `agent-overview`; scenario titles match test names

## 4. Adversarial review fixes (no CRITICAL findings)

- [x] 4.1 Watcher worker re-reads the watched set under the cache lock before patching/retaining (a concurrent `subagents_for` seed could lose or resurrect a session's rows)
- [x] 4.2 PTY writer thread is spawned before the reader thread (no running child outside the registry if the later spawn fails)
- [x] 4.3 Wake detection needs a 60 s gap while the window is hidden (throttled timers / App Nap are not a wake)
- [x] 4.4 Post-wake fetch timer survives a later resume (it was cancelled without being rescheduled)
- [x] 4.5 Statusline wrapper never caches a git status that git did not answer (timeout / index.lock)
- [x] 4.6 Burst test waits generously for the first emit (flake on a loaded machine)
- [x] 4.7 Accepted (WARNING): the per-pane write queue is unbounded; bounded in practice by user input, and every caller already ignored write errors
