//! Real PTY integration tests for the terminal-core capability.
//!
//! These spawn harmless programs (`/bin/echo`, `bash -c …`, `cat`) inside a
//! real PTY via `portable-pty` and drive the production read loop with a
//! generic test sink (an `mpsc` channel) instead of a live Tauri `Channel`,
//! so the lifecycle (spawn → read → resize → write → kill → reap) is covered
//! headlessly.
//!
//! Test fn names map to the `#### Scenario:` names in
//! `openspec/changes/add-agent-desktop/specs/terminal-core/spec.md`
//! (snake_case) so the coverage gate can match them.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use app_lib::pty::{PtyEvent, PtyManager, SpawnConfig};

/// Block until either an `Exit` event arrives or `timeout` elapses,
/// concatenating all `Data` payloads seen along the way.
fn drain_until_exit(rx: &mpsc::Receiver<PtyEvent>, timeout: Duration) -> (Vec<u8>, Option<i32>) {
    let deadline = Instant::now() + timeout;
    let mut data = Vec::new();
    let mut code = None;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(PtyEvent::Data { bytes }) => data.extend_from_slice(&bytes),
            Ok(PtyEvent::Exit { code: c }) => {
                code = Some(c);
                break;
            }
            Err(_) => break,
        }
    }
    (data, code)
}

// === Requirement: PTY-Backed Process Spawning ===

/// #### Scenario: Spawn with seeded environment in target cwd
#[test]
fn spawn_with_seeded_environment_in_target_cwd() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();

    // `pwd` should print the cwd we asked for; `env` lets us assert the
    // seeded TERM/COLORTERM reached the child environment.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            "pwd; printf 'TERM=%s\\n' \"$TERM\"; printf 'COLORTERM=%s\\n' \"$COLORTERM\"".into(),
        ],
        cwd: Some("/tmp".into()),
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");
    assert!(id >= 1);

    let (data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    let text = String::from_utf8_lossy(&data);
    // macOS /tmp is a symlink to /private/tmp; accept either spelling.
    assert!(
        text.contains("/tmp") || text.contains("/private/tmp"),
        "cwd not honored, got: {text:?}"
    );
    assert!(
        text.contains("TERM=xterm-256color"),
        "TERM not seeded, got: {text:?}"
    );
    assert!(
        text.contains("COLORTERM=truecolor"),
        "COLORTERM not seeded, got: {text:?}"
    );
    assert_eq!(code, Some(0));
}

/// #### Scenario: Caller env merges after the seed and wins on collision
///
/// The optional `SpawnConfig::env` is applied AFTER `seed_env`, so a
/// caller-supplied var (the usage-dashboard `AGENT_DESKTOP_PANE` /
/// `AGENT_DESKTOP_SNAPSHOT_DIR`) reaches the child, and a caller value for a
/// seeded key (here `TERM`) overrides the seeded default.
#[test]
fn caller_env_merges_after_seed_and_wins_on_collision() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            "printf 'PANE=%s\\n' \"$AGENT_DESKTOP_PANE\"; \
             printf 'SNAP=%s\\n' \"$AGENT_DESKTOP_SNAPSHOT_DIR\"; \
             printf 'TERM=%s\\n' \"$TERM\""
                .into(),
        ],
        cwd: None,
        cols: 80,
        rows: 24,
        env: vec![
            ("AGENT_DESKTOP_PANE".into(), "pane-abc".into()),
            ("AGENT_DESKTOP_SNAPSHOT_DIR".into(), "/snap/dir".into()),
            // Collides with a seeded key: the caller value must win.
            ("TERM".into(), "caller-term".into()),
        ],
    };
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    let (data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    let text = String::from_utf8_lossy(&data);
    assert!(
        text.contains("PANE=pane-abc"),
        "AGENT_DESKTOP_PANE not passed, got: {text:?}"
    );
    assert!(
        text.contains("SNAP=/snap/dir"),
        "AGENT_DESKTOP_SNAPSHOT_DIR not passed, got: {text:?}"
    );
    assert!(
        text.contains("TERM=caller-term"),
        "caller env must win over seeded TERM, got: {text:?}"
    );
    assert_eq!(code, Some(0));
}

/// #### Scenario: Slave dropped so EOF is deliverable
///
/// If the slave fd were retained, the master read loop would never observe
/// EOF and `drain_until_exit` would time out without an Exit event. Observing
/// an Exit proves EOF was delivered, which requires the slave to be dropped.
#[test]
fn slave_dropped_so_eof_is_deliverable() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    let cfg = SpawnConfig {
        program: "/bin/echo".into(),
        args: vec!["hello".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    let (_data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    assert!(
        code.is_some(),
        "no Exit event => EOF never delivered => slave was not dropped"
    );
}

// === Requirement: Lossless Ordered Output Streaming ===

/// #### Scenario: Raw bytes forwarded in order over the channel
#[test]
fn raw_bytes_forwarded_in_order_over_the_channel() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // Print a deterministic ordered sequence with no trailing transforms.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec!["-c".into(), "printf 'ABCDEFG'".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    let (data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    assert_eq!(code, Some(0));
    // PTYs translate \n -> \r\n, but with no newline the payload is verbatim
    // and ordered.
    assert!(
        data.windows(7).any(|w| w == b"ABCDEFG"),
        "ordered bytes not forwarded verbatim, got: {:?}",
        String::from_utf8_lossy(&data)
    );
}

/// #### Scenario: Split multibyte sequence reassembled by xterm
///
/// We cannot run xterm here, but the Rust-side guarantee under test is that no
/// `from_utf8`/decoding is applied: the raw multibyte bytes (and an ANSI
/// escape sequence) are forwarded verbatim regardless of how the kernel chunks
/// the reads, so the concatenation of all `Data` payloads contains the exact
/// original byte sequence ready for xterm to reassemble.
#[test]
fn split_multibyte_sequence_reassembled_by_xterm() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // U+1F600 (😀) = F0 9F 98 80, plus an ANSI SGR red sequence: ESC[31m.
    // Emit a large run so the kernel is forced to split reads across the
    // multibyte boundary at least once.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            // 4000 smiley codepoints, then a bare ANSI sequence, no newline.
            "for i in $(seq 1 4000); do printf '\\360\\237\\230\\200'; done; printf '\\033[31mX'"
                .into(),
        ],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    let (data, code) = drain_until_exit(&rx, Duration::from_secs(15));
    assert_eq!(code, Some(0));

    // The smiley bytes appear exactly 4000 times, never corrupted into U+FFFD
    // (EF BF BD) by a premature decode.
    let smiley = [0xF0u8, 0x9F, 0x98, 0x80];
    let count = data.windows(4).filter(|w| *w == smiley).count();
    assert_eq!(count, 4000, "multibyte payload corrupted or truncated");
    assert!(
        !data.windows(3).any(|w| w == [0xEF, 0xBF, 0xBD]),
        "U+FFFD replacement char present => Rust decoded UTF-8 (forbidden)"
    );
    // The ANSI escape sequence survived verbatim.
    assert!(
        data.windows(5).any(|w| w == b"\x1b[31m"),
        "ANSI escape sequence corrupted"
    );
}

// === Requirement: Blocking Read Loop With Coalescing ===

/// #### Scenario: Read loop runs on a native thread
///
/// `spawn_with_sink` must return immediately (the blocking read happens on a
/// dedicated std::thread, not the caller's thread / an async runtime). We
/// assert the call returns long before the child finishes its slow output.
#[test]
fn read_loop_runs_on_a_native_thread() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        // Sleep first so the child has produced no output yet when spawn returns.
        args: vec!["-c".into(), "sleep 1; printf done".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let start = Instant::now();
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");
    // Returning quickly proves the read happens off-thread.
    assert!(
        start.elapsed() < Duration::from_millis(500),
        "spawn_with_sink blocked on the read loop"
    );

    let (data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    assert_eq!(code, Some(0));
    assert!(String::from_utf8_lossy(&data).contains("done"));
}

/// #### Scenario: Bulk output is batched
///
/// Under a large burst, the read loop coalesces into a small number of
/// batched `Data` events rather than one event per syscall. We emit ~256KiB
/// and assert the byte total is intact while the number of `Data` messages is
/// far smaller than it would be at one-per-read granularity.
#[test]
fn bulk_output_is_batched() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // 256 KiB of 'a' via yes|head, no newlines added by us.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec!["-c".into(), "head -c 262144 /dev/zero | tr '\\0' a".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    // Count events explicitly so we can assert batching.
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut total = 0usize;
    let mut data_events = 0usize;
    let mut got_exit = false;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(PtyEvent::Data { bytes }) => {
                total += bytes.len();
                data_events += 1;
            }
            Ok(PtyEvent::Exit { .. }) => {
                got_exit = true;
                break;
            }
            Err(_) => break,
        }
    }
    assert!(got_exit, "child never exited");
    assert_eq!(total, 262144, "byte total not preserved under batching");
    // A raw read buffer is typically <= 64KiB per syscall on a pipe/pty, so an
    // un-batched loop would yield many dozens of events. Coalescing into
    // <=64KiB batches keeps this comfortably small.
    assert!(
        data_events <= 16,
        "expected coalesced batches, got {data_events} Data events"
    );
}

// === Requirement: Input Forwarding To PTY ===

/// #### Scenario: Keystroke reaches the PTY writer
#[test]
fn keystroke_reaches_the_pty_writer() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // Print a readiness marker, then `exec cat` so stdin is the PTY. `cat`
    // echoes its stdin back out, so the bytes we write must reappear. We wait
    // for READY before writing to avoid racing child startup (a pre-attach
    // write would be dropped by the line discipline — a real property, not the
    // behavior under test here, which is that a write made to a live pane
    // reaches the PTY writer).
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec!["-c".into(), "printf 'READY\\n'; exec cat".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    // Wait until the child signals it is up and `cat` has the PTY for stdin.
    let ready_deadline = Instant::now() + Duration::from_secs(10);
    let mut pre = Vec::new();
    let mut ready = false;
    while Instant::now() < ready_deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Data { bytes }) => {
                pre.extend_from_slice(&bytes);
                if pre.windows(5).any(|w| w == b"READY") {
                    ready = true;
                    break;
                }
            }
            Ok(PtyEvent::Exit { .. }) => break,
            Err(_) => {}
        }
    }
    assert!(ready, "child never signalled readiness");

    manager
        .write(id, b"ping\n".to_vec())
        .expect("write should succeed");

    // Read until we see our echoed input (cat keeps running; don't wait for exit).
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut data = Vec::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Data { bytes }) => {
                data.extend_from_slice(&bytes);
                if data.windows(4).any(|w| w == b"ping") {
                    break;
                }
            }
            Ok(PtyEvent::Exit { .. }) => break,
            Err(_) => {}
        }
    }
    assert!(
        data.windows(4).any(|w| w == b"ping"),
        "input did not reach the PTY writer; got: {:?}",
        String::from_utf8_lossy(&data)
    );

    manager.kill(id).expect("kill should succeed");
}

/// #### Scenario: Write to a nonexistent pane is rejected
#[test]
fn write_to_a_nonexistent_pane_is_rejected() {
    let manager = PtyManager::new();
    // No pane with id 9999 exists; must Err, not panic.
    let res = manager.write(9999, b"data".to_vec());
    assert!(res.is_err(), "write to dead pane should return Err");
}

// === Requirement: PTY Resize Round-Trip ===

/// #### Scenario: Pane resize propagates new dimensions to the child
#[test]
fn pane_resize_propagates_new_dimensions_to_the_child() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // `cat` keeps the pane alive while we resize and query.
    let cfg = SpawnConfig {
        program: "/bin/cat".into(),
        args: vec![],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    manager.resize(id, 120, 40).expect("resize should succeed");

    let size = manager.get_size(id).expect("get_size should succeed");
    assert_eq!(size.cols, 120, "cols not propagated to the kernel");
    assert_eq!(size.rows, 40, "rows not propagated to the kernel");

    manager.kill(id).expect("kill should succeed");
    drop(rx);
}

/// #### Scenario: Fit guarded against zero-sized container
///
/// The Rust resize command must reject 0×0 (the frontend guards `fit()`, but
/// the backend defends too): a resize to zero cols/rows returns Err and never
/// changes the kernel's winsize.
#[test]
fn fit_guarded_against_zero_sized_container() {
    let manager = PtyManager::new();
    let (tx, _rx) = mpsc::channel();
    let cfg = SpawnConfig {
        program: "/bin/cat".into(),
        args: vec![],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    assert!(
        manager.resize(id, 0, 40).is_err(),
        "0 cols must be rejected"
    );
    assert!(
        manager.resize(id, 120, 0).is_err(),
        "0 rows must be rejected"
    );

    // Winsize unchanged from the original 80x24.
    let size = manager.get_size(id).expect("get_size should succeed");
    assert_eq!(size.cols, 80);
    assert_eq!(size.rows, 24);

    manager.kill(id).expect("kill should succeed");
}

/// #### Scenario: Write to nonexistent pane via resize is rejected (resize arm).
#[test]
fn resize_to_a_nonexistent_pane_is_rejected() {
    let manager = PtyManager::new();
    assert!(
        manager.resize(9999, 100, 30).is_err(),
        "resize on dead pane should return Err"
    );
}

// === Requirement: Child Exit Detection And Reaping ===

/// #### Scenario: Exit code surfaced on child termination
#[test]
fn exit_code_surfaced_on_child_termination() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // Exit with a specific nonzero code so we know it's the real child code.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec!["-c".into(), "exit 7".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    let (_data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    assert_eq!(code, Some(7), "child exit code not surfaced");
}

/// #### Scenario: Channel gone stops the read loop
///
/// If the sink starts returning Err (channel torn down) while output is still
/// pending, the read loop must terminate instead of spinning/panicking. We
/// spawn a long-running producer, drop the receiver, and assert the pane's
/// read thread finishes (joins) promptly without a panic.
#[test]
fn channel_gone_stops_the_read_loop() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // Continuous output forever, so the loop is actively sending when we drop.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec!["-c".into(), "while true; do printf 'x'; done".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    // Let it produce a bit, then sever the channel.
    let _ = rx.recv_timeout(Duration::from_secs(5));
    drop(rx);

    // The read loop should notice the send failure and stop on its own. Assert
    // the read thread joined (no leak/spin) via `join_reader` — which also removes
    // the pane from the registry. We do this BEFORE `kill` because `kill` now
    // removes+drops the pane (taking its reader handle), so a join must observe
    // the thread first.
    assert!(
        manager.join_reader(id, Duration::from_secs(10)),
        "read loop did not terminate after the channel was dropped"
    );
    // `kill` after the pane is already gone is an idempotent no-op (returns Ok).
    manager.kill(id).expect("kill on an absent pane is a no-op");
}

// === Requirement: Process Lifecycle And No Orphans ===

/// #### Scenario: Closing a pane kills its process
#[test]
fn closing_a_pane_kills_its_process() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel();
    // A process that would otherwise run for a long time.
    let cfg = SpawnConfig {
        program: "/bin/sh".into(),
        args: vec!["-c".into(), "sleep 300".into()],
        cwd: None,
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");

    manager.kill(id).expect("kill should succeed");

    // Killing terminates and reaps: the read loop sees EOF and emits Exit.
    let (_data, code) = drain_until_exit(&rx, Duration::from_secs(10));
    assert!(
        code.is_some(),
        "killed child was not reaped / no Exit emitted"
    );
}

/// #### Scenario: App quit reaps all children
#[test]
fn app_quit_reaps_all_children() {
    let manager = PtyManager::new();
    let mut receivers = Vec::new();
    for _ in 0..3 {
        let (tx, rx) = mpsc::channel();
        let cfg = SpawnConfig {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "sleep 300".into()],
            cwd: None,
            cols: 80,
            rows: 24,
            ..Default::default()
        };
        manager
            .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
            .expect("spawn should succeed");
        receivers.push(rx);
    }

    // Simulate CloseRequested.
    manager.kill_all();

    // Every pane's child must be killed + reaped (Exit on each channel),
    // and the registry must be empty afterward.
    for rx in &receivers {
        let (_d, code) = drain_until_exit(rx, Duration::from_secs(10));
        assert!(code.is_some(), "a child was not reaped on kill_all");
    }
    assert_eq!(manager.live_count(), 0, "panes remain after kill_all");
}
