//! Real-PTY tests for the terminal-core "Foreground Job Query" requirement:
//! `PtyManager::foreground_busy` answers whether a pane's terminal is owned by a
//! foreground job (the kernel's foreground process group differs from the
//! shell's own group). Drives an INTERACTIVE bash (`-i`, so job control puts
//! each foreground command in its own process group) inside a real PTY.
//!
//! Test fn names map to the `#### Scenario:` names in
//! `openspec/changes/shortcuts-worktrees-combined-terminals/specs/terminal-core/spec.md`
//! (snake_case) so the coverage gate can match them.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use app_lib::pty::{PtyEvent, PtyManager, SpawnConfig};

/// Spawn an interactive bash with job control and no rc files, returning the
/// pane id + the event receiver.
#[cfg(unix)]
fn spawn_interactive_bash(manager: &PtyManager) -> (u64, mpsc::Receiver<PtyEvent>) {
    let (tx, rx) = mpsc::channel();
    let cfg = SpawnConfig {
        program: "bash".into(),
        args: vec!["--norc".into(), "--noprofile".into(), "-i".into()],
        cwd: Some("/tmp".into()),
        cols: 80,
        rows: 24,
        ..Default::default()
    };
    let id = manager
        .spawn_with_sink(cfg, move |ev| tx.send(ev).map_err(|_| ()))
        .expect("spawn should succeed");
    (id, rx)
}

/// Poll the probe until it reports `want` or `timeout` elapses; returns the
/// last observed answer.
#[cfg(unix)]
fn wait_for(manager: &PtyManager, id: u64, want: bool, timeout: Duration) -> Option<bool> {
    let deadline = Instant::now() + timeout;
    let mut last = None;
    while Instant::now() < deadline {
        last = manager.foreground_busy(id).expect("live pane");
        if last == Some(want) {
            return last;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    last
}

/// #### Scenario: Idle shell reports no foreground job
#[cfg(unix)]
#[test]
fn idle_shell_reports_no_foreground_job() {
    let manager = PtyManager::new();
    let (id, _rx) = spawn_interactive_bash(&manager);
    // Once bash has taken the terminal (its prompt is up) the foreground group
    // is the shell's own, so the probe answers false.
    let got = wait_for(&manager, id, false, Duration::from_secs(5));
    assert_eq!(got, Some(false), "an idle interactive shell must read as not busy");
    manager.kill(id).expect("kill");
}

/// #### Scenario: Running foreground command reports a job
#[cfg(unix)]
#[test]
fn running_foreground_command_reports_a_job() {
    let manager = PtyManager::new();
    let (id, _rx) = spawn_interactive_bash(&manager);
    assert_eq!(
        wait_for(&manager, id, false, Duration::from_secs(5)),
        Some(false),
        "shell should be at its prompt before the command runs"
    );
    // A foreground `sleep` gets its own process group under job control, which
    // the kernel makes the terminal's foreground group.
    manager.write(id, b"sleep 30\n".to_vec()).expect("write");
    let got = wait_for(&manager, id, true, Duration::from_secs(5));
    assert_eq!(got, Some(true), "a running foreground command must read as busy");
    // Interrupting it hands the terminal back to the shell.
    manager.write(id, vec![0x03]).expect("write ^C");
    let back = wait_for(&manager, id, false, Duration::from_secs(5));
    assert_eq!(back, Some(false), "after ^C the shell is idle again");
    manager.kill(id).expect("kill");
}

/// #### Scenario: Unknown pane yields an error
#[test]
fn unknown_pane_yields_an_error() {
    let manager = PtyManager::new();
    let err = manager.foreground_busy(987_654).expect_err("no such pane");
    assert!(err.contains("no live pane"), "unexpected error text: {err}");
}
