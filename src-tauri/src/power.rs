//! Best-effort system idle-sleep inhibitor ("keep awake").
//!
//! ## Why
//!
//! Agents are long-running network clients: a Claude Code session mid-turn holds
//! an open streaming HTTPS connection, and a background `npm install` or `git
//! push` is one too. When the machine idle-sleeps those connections die, the
//! agent's turn fails, and the user comes back to a stalled session. Holding a
//! *system* (not display) sleep assertion while agents are working keeps the
//! network up; the screen may still go dark.
//!
//! ## Who decides
//!
//! Policy lives in the frontend, which knows the roster of agents and the user's
//! setting. It picks between three modes — never / while any agent is running /
//! while the app is open — and calls [`keep_awake_set`] with the resulting
//! boolean whenever the answer changes. The backend never sees the mode; it only
//! sees "hold" or "don't hold", and [`Inhibitor`] collapses repeated calls so the
//! platform shim runs exactly once per edge.
//!
//! ## Layers
//!
//!   * [`Inhibitor`] — PURE, headless-testable desired-state tracker. `set`
//!     returns the [`Transition`] to perform, or `None` when nothing changed.
//!   * [`PowerState`] — the managed Tauri state: the inhibitor plus the live
//!     platform handle, behind a mutex. `set` applies transitions through the
//!     platform shim; `shutdown` forces a release on window close.
//!   * Platform shims (`acquire` / `release`) — one per OS, cfg-gated.
//!
//! ## Why the inhibitor cannot outlive the app
//!
//!   * macOS: `caffeinate -i -s -w <our pid>` — `-w` tells caffeinate to exit by
//!     itself once our process is gone, so even a hard crash (no `shutdown`)
//!     leaves nothing behind. The assertion dies with the child.
//!   * Windows: `SetThreadExecutionState(ES_CONTINUOUS | ...)` is *per thread*
//!     and is cleared by the OS when that thread ends; the thread is ours, so
//!     process exit clears it unconditionally.
//!   * Linux: `systemd-inhibit ... tail --pid=<our pid> -f /dev/null` holds the
//!     lock only as long as our process exists — Linux does NOT kill children on
//!     parent exit, so the `tail --pid` watch (the `caffeinate -w` equivalent) is
//!     what guarantees an update relaunch, crash, or SIGTERM leaves no orphaned
//!     block-mode inhibitor. It is killed on release.
//!
//! ## Best-effort
//!
//! Every platform call can fail (binary missing, sandbox, unsupported OS). All
//! failures are logged with `log::warn!` and swallowed; nothing here ever returns
//! an error, panics, or blocks the UI. A missing inhibitor simply means the
//! machine may sleep — the same as before this module existed.

use std::sync::Mutex;

/// What the platform shim must do after a [`Inhibitor::set`] call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transition {
    /// Start holding the system-sleep assertion.
    Acquire,
    /// Stop holding it.
    Release,
}

/// Idempotent desired-state tracker. Pure: holds no OS state.
#[derive(Debug, Default)]
pub struct Inhibitor {
    held: bool,
}

impl Inhibitor {
    /// Record the desired state. Returns the transition to perform only when
    /// the state actually changed; repeated calls with the same value are no-ops.
    pub fn set(&mut self, desired: bool) -> Option<Transition> {
        if desired == self.held {
            return None;
        }
        self.held = desired;
        Some(if desired {
            Transition::Acquire
        } else {
            Transition::Release
        })
    }

    /// Whether the assertion is currently (meant to be) held.
    pub fn is_held(&self) -> bool {
        self.held
    }
}

/// Mutable half of [`PowerState`]: the tracker plus the live platform handle.
struct PowerInner {
    inhibitor: Inhibitor,
    /// The OS-level assertion, present only while held AND the shim succeeded.
    handle: Option<PlatformHandle>,
    /// Test-only: skip the platform shim so the tests run on every OS.
    #[cfg(test)]
    dry_run: bool,
    /// Test-only: the last transition that was applied.
    #[cfg(test)]
    last_transition: Option<Transition>,
}

/// Managed Tauri state for the keep-awake inhibitor. Never panics; a poisoned
/// mutex is recovered (the inner state is plain data, so it is always usable).
pub struct PowerState {
    inner: Mutex<PowerInner>,
}

impl Default for PowerState {
    fn default() -> Self {
        Self::new()
    }
}

impl PowerState {
    /// A fresh, released state.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(PowerInner {
                inhibitor: Inhibitor::default(),
                handle: None,
                #[cfg(test)]
                dry_run: false,
                #[cfg(test)]
                last_transition: None,
            }),
        }
    }

    /// A state whose platform shim is a no-op, so tests run on every OS.
    #[cfg(test)]
    pub fn new_for_test() -> Self {
        let state = Self::new();
        state.lock().dry_run = true;
        state
    }

    /// Test-only: the last transition applied via `set`/`shutdown`.
    #[cfg(test)]
    pub fn last_transition(&self) -> Option<Transition> {
        self.lock().last_transition
    }

    /// Whether the assertion is currently meant to be held.
    #[cfg(test)]
    pub fn is_held(&self) -> bool {
        self.lock().inhibitor.is_held()
    }

    /// Ask for the assertion to be held (`true`) or released (`false`).
    /// Idempotent; the platform shim only runs on an actual change.
    pub fn set(&self, enabled: bool) {
        let mut inner = self.lock();
        if let Some(transition) = inner.inhibitor.set(enabled) {
            Self::apply(&mut inner, transition);
        }
    }

    /// Force a release. Called from the window's CloseRequested handler so the
    /// assertion never outlives the app (belt-and-braces: every platform shim
    /// also dies with the process, see the module docs).
    pub fn shutdown(&self) {
        self.set(false);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, PowerInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Run the platform shim for `transition` and record the resulting handle.
    fn apply(inner: &mut PowerInner, transition: Transition) {
        #[cfg(test)]
        {
            inner.last_transition = Some(transition);
            if inner.dry_run {
                return;
            }
        }
        match transition {
            Transition::Acquire => {
                // Defensive: never leak a previous handle.
                if let Some(old) = inner.handle.take() {
                    release(old);
                }
                inner.handle = acquire();
            }
            Transition::Release => {
                if let Some(handle) = inner.handle.take() {
                    release(handle);
                }
            }
        }
    }
}

/// Frontend entry point: `true` while the chosen mode says the machine must
/// stay awake, `false` otherwise. Safe to call repeatedly with the same value.
#[tauri::command]
pub fn keep_awake_set(state: tauri::State<'_, PowerState>, enabled: bool) {
    state.set(enabled)
}

// ---------------------------------------------------------------------------
// Platform shims. Each exposes `acquire() -> Option<PlatformHandle>` and
// `release(PlatformHandle)`; failures are logged and swallowed.
// ---------------------------------------------------------------------------

/// macOS: `caffeinate` holds the assertion for as long as it runs; `-w <pid>`
/// makes it exit on its own once we are gone.
#[cfg(target_os = "macos")]
type PlatformHandle = std::process::Child;

#[cfg(target_os = "macos")]
fn acquire() -> Option<PlatformHandle> {
    use std::process::{Command, Stdio};
    // -i: prevent idle sleep; -s: prevent system sleep (on AC); -w: exit when
    // the given pid exits.
    match Command::new("caffeinate")
        .args(["-i", "-s", "-w", &std::process::id().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => {
            log::debug!("keep-awake: caffeinate started (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            log::warn!("keep-awake: failed to start caffeinate: {e}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn release(mut child: PlatformHandle) {
    kill_and_reap(&mut child, "caffeinate");
}

/// Windows: `SetThreadExecutionState` is per-thread and cleared when the thread
/// ends, so a dedicated thread owns the assertion for exactly as long as it
/// blocks on the release channel.
#[cfg(windows)]
struct PlatformHandle {
    /// Dropping (or sending on) this wakes the owning thread, which clears the
    /// assertion and exits.
    release: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(es_flags: u32) -> u32;
}

#[cfg(windows)]
const ES_CONTINUOUS: u32 = 0x8000_0000;
#[cfg(windows)]
const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

#[cfg(windows)]
fn acquire() -> Option<PlatformHandle> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<()>();
    let spawned = std::thread::Builder::new()
        .name("keep-awake".into())
        .spawn(move || {
            // SAFETY: plain FFI call with no pointers; documented to return 0
            // on failure and the previous state otherwise.
            let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            if prev == 0 {
                log::warn!("keep-awake: SetThreadExecutionState(acquire) failed");
            }
            // Block until told to release, or until the sender is dropped.
            let _ = rx.recv();
            // SAFETY: as above.
            let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            if prev == 0 {
                log::warn!("keep-awake: SetThreadExecutionState(release) failed");
            }
        });
    match spawned {
        Ok(thread) => Some(PlatformHandle {
            release: Some(tx),
            thread: Some(thread),
        }),
        Err(e) => {
            log::warn!("keep-awake: failed to spawn keep-awake thread: {e}");
            None
        }
    }
}

#[cfg(windows)]
fn release(mut handle: PlatformHandle) {
    if let Some(tx) = handle.release.take() {
        // A send failure just means the thread already exited.
        let _ = tx.send(());
        drop(tx);
    }
    if let Some(thread) = handle.thread.take() {
        if thread.join().is_err() {
            log::warn!("keep-awake: keep-awake thread panicked");
        }
    }
}

/// Linux: `systemd-inhibit` holds a sleep/idle lock while its child runs. That
/// child is `tail --pid=<our pid> -f /dev/null` (coreutils), which exits by itself
/// once our process is gone — Linux never kills children on parent exit, so
/// without this an update relaunch (`process::exit`, no CloseRequested), a crash,
/// or a SIGTERM would leave a block-mode inhibitor held until reboot. Missing
/// binary (non-systemd distro) is a quiet no-op.
#[cfg(target_os = "linux")]
type PlatformHandle = std::process::Child;

#[cfg(target_os = "linux")]
fn acquire() -> Option<PlatformHandle> {
    use std::process::{Command, Stdio};
    let pid_watch = format!("--pid={}", std::process::id());
    match Command::new("systemd-inhibit")
        .args([
            "--what=sleep:idle",
            "--who=agent-desktop",
            "--why=An agent is running",
            "--mode=block",
            "tail",
            &pid_watch,
            "-f",
            "/dev/null",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => {
            log::debug!("keep-awake: systemd-inhibit started (pid {})", child.id());
            Some(child)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log::info!("keep-awake: systemd-inhibit not available; not inhibiting sleep");
            None
        }
        Err(e) => {
            log::warn!("keep-awake: failed to start systemd-inhibit: {e}");
            None
        }
    }
}

#[cfg(target_os = "linux")]
fn release(mut child: PlatformHandle) {
    kill_and_reap(&mut child, "systemd-inhibit");
}

/// Kill a child inhibitor process and reap it so no zombie remains.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn kill_and_reap(child: &mut std::process::Child, name: &str) {
    if let Err(e) = child.kill() {
        // Already exited (e.g. reaped by `-w`) is the common benign case.
        log::debug!("keep-awake: kill {name}: {e}");
    }
    if let Err(e) = child.wait() {
        log::warn!("keep-awake: failed to reap {name}: {e}");
    }
}

/// Unsupported platform: nothing to hold. Uninhabited so `Option<PlatformHandle>`
/// is always `None` without a never-constructed warning.
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
enum PlatformHandle {}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn acquire() -> Option<PlatformHandle> {
    log::info!("keep-awake: unsupported platform; not inhibiting sleep");
    None
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn release(handle: PlatformHandle) {
    match handle {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_release_are_idempotent() {
        let mut inhibitor = Inhibitor::default();
        assert!(!inhibitor.is_held());
        assert_eq!(inhibitor.set(false), None, "releasing when never held is a no-op");

        assert_eq!(inhibitor.set(true), Some(Transition::Acquire));
        assert!(inhibitor.is_held());
        assert_eq!(inhibitor.set(true), None, "second acquire is a no-op");
        assert!(inhibitor.is_held());

        assert_eq!(inhibitor.set(false), Some(Transition::Release));
        assert!(!inhibitor.is_held());
        assert_eq!(inhibitor.set(false), None, "second release is a no-op");
        assert!(!inhibitor.is_held());
    }

    #[test]
    fn inhibitor_is_released_when_the_app_closes() {
        let state = PowerState::new_for_test();
        state.set(true);
        assert!(state.is_held());
        assert_eq!(state.last_transition(), Some(Transition::Acquire));

        // The window's CloseRequested handler calls `shutdown` — it must force
        // a release regardless of what the frontend last asked for.
        state.shutdown();
        assert!(!state.is_held());
        assert_eq!(state.last_transition(), Some(Transition::Release));

        // And a second shutdown is harmless.
        state.shutdown();
        assert!(!state.is_held());
    }
}
