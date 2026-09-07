# Tasks

- [x] 1.1 Failing integration tests in `src-tauri/tests/pty_integration.rs`:
      nohup'd grandchild survives pane close, HUP-trapping child survives pane
      close, nohup'd grandchild survives `kill_all`.
- [x] 1.2 `process_tree::terminate` in `src-tauri/src/pty.rs`: SIGHUP leader +
      SIGTERM descendants/process group, grace, re-walk via `ps`, SIGKILL
      survivors; `taskkill /T /F` on Windows. `libc` pinned as a unix dep.
- [x] 1.3 `PtyManager::kill` escalates off-thread (1s grace); `kill_all`
      escalates in parallel and synchronously (500ms grace) before joining
      readers.
- [x] 1.4 `cargo test` (all 308 + 19 PTY integration) green; no new clippy
      warnings in touched files.
