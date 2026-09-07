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
- [x] 2.1 Adversarial review round 1: signal BEFORE dropping the PTY (writer
      drop sends `^D`, an interactive shell then exits without HUP-ing jobs);
      track pids + process groups across the grace period so reparented jobs
      are still force-killed; never re-signal a reaped child (`reaped` flag,
      root must be our live child per `ps`); never signal pid ≤ 1; `kill_all`
      joins pending killer threads and bounds reader joins; `ps` failure falls
      back to leader + group instead of "tree is dead". Two more failing tests
      (job in own pgrp ignoring TERM/HUP; interactive bash background job) and
      unit tests for the discovery guards.
- [x] 2.2 Adversarial review round 2: a child that exited on its own but left
      HUP-ignoring jobs behind was skipped entirely — discovery now seeds from
      the child's process group when the root is gone or a zombie (a pid cannot
      be recycled while its group exists), rejects a live root that is not our
      child, and never tracks zombies; all kill work (snapshot, signals, grace,
      forced kill, then the possibly-blocking PTY drop) runs on the killer
      thread with an inline fallback; one `ps` per poll tick shared by all
      trees; finished killer threads pruned. Two more tests (orphans after an
      exited child, on close and on quit) and unit tests for the discovery rules.
