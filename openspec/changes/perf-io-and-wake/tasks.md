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
