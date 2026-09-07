//! PTY backend for the `terminal-core` capability.
//!
//! Each pane is a real PTY created via `portable-pty`'s
//! `native_pty_system().openpty(...)`. The configured program is launched in a
//! given `cwd` with a seeded environment, the slave half is dropped so the
//! kernel will deliver EOF on the master reader, and a dedicated `std::thread`
//! runs a blocking read loop that ships raw, ordered bytes to the frontend over
//! a per-pane Tauri `Channel<PtyEvent>` (NO UTF-8 decoding in Rust). Output is
//! coalesced into ~8–16ms / up to 64 KiB batches under bulk load.
//!
//! The read loop is factored around a generic sink closure so it can be driven
//! by an `mpsc` channel in integration tests without a live Tauri `Channel`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

/// Stable per-pane identifier.
pub type PaneId = u64;

/// Coalescing knobs for the read loop. Under bulk output we flush either when
/// the batch reaches `MAX_BATCH` bytes or when `MAX_LATENCY` has elapsed since
/// the batch's first byte, whichever comes first — there is no real PTY
/// backpressure, so batching happens on the Rust side.
const MAX_BATCH: usize = 64 * 1024;
const MAX_LATENCY: Duration = Duration::from_millis(12);
/// Per-read scratch buffer handed to the blocking `read` syscall.
const READ_CHUNK: usize = 64 * 1024;

/// Event streamed to the frontend over a per-pane `Channel<PtyEvent>`.
///
/// Serialized as an internally tagged enum so the JS side can switch on the
/// `event` field:
///   `{ "event": "data", "bytes": [/* u8 */] }`
///   `{ "event": "exit", "code": <i32> }`
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum PtyEvent {
    /// Raw, ordered output bytes read from the PTY master. Never UTF-8 decoded
    /// in Rust; the frontend writes them via `term.write(new Uint8Array(bytes))`.
    Data { bytes: Vec<u8> },
    /// The child exited (observed as EOF on the master, then reaped via
    /// `child.wait()`); `code` is the process exit code.
    Exit { code: i32 },
}

/// Parameters for spawning a pane's PTY-backed process.
#[derive(Debug, Clone, Default)]
pub struct SpawnConfig {
    /// Program to execute (e.g. `claude`, `/bin/sh`).
    pub program: String,
    /// Arguments passed to the program.
    pub args: Vec<String>,
    /// Working directory for the child; if `None`, inherits the app's cwd.
    pub cwd: Option<String>,
    /// Initial terminal columns.
    pub cols: u16,
    /// Initial terminal rows.
    pub rows: u16,
    /// Extra environment entries merged into the child env AFTER the seeded
    /// `TERM`/`COLORTERM`/`PATH`/`HOME`/`LANG`, so a caller-supplied value (e.g.
    /// the usage-dashboard `AGENT_DESKTOP_PANE`/`AGENT_DESKTOP_SNAPSHOT_DIR`)
    /// wins on a key collision. Defaults to empty, so existing callers (and the
    /// shell panes) spawn with exactly the seeded env and nothing extra.
    pub env: Vec<(String, String)>,
}

/// Live per-pane state held in the manager's registry.
struct Pane {
    /// Master side of the PTY; used for resize and to take the writer.
    master: Box<dyn MasterPty + Send>,
    /// Writer into the PTY (slave stdin); raw bytes, no decoding.
    writer: Box<dyn Write + Send>,
    /// Killer cloned from the child so we can terminate it from any thread.
    /// Fallback only: the primary teardown path is [`process_tree::terminate`]
    /// on `pid`, which also reaches descendants the killer cannot see.
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// OS pid of the direct child (the PTY session leader). `None` only if the
    /// platform child handle cannot report one.
    pid: Option<u32>,
    /// Set by the read loop the moment it has `wait()`ed the child. Once set,
    /// `pid` may already belong to an unrelated process and must never be
    /// signalled again.
    reaped: Arc<AtomicBool>,
    /// Handle to the dedicated read-loop thread, so we can join on teardown.
    reader: Option<JoinHandle<()>>,
}

/// Upper bound on waiting for a pane's reader thread during `kill_all`. The
/// thread ends on EOF from the slave, which a straggler we could not see (a
/// double-forked daemon) might still hold open; the app must quit regardless.
const READER_JOIN_TIMEOUT: Duration = Duration::from_secs(2);

/// How long a pane's process tree gets to exit after the graceful signals
/// before survivors are force-killed (single-pane close; runs off-thread).
const KILL_GRACE: Duration = Duration::from_millis(1000);
/// Same, for app quit (`kill_all`), which blocks the close handler — shorter.
const KILL_ALL_GRACE: Duration = Duration::from_millis(500);

/// Tauri-managed state: a registry of live panes plus a monotonic id counter.
pub struct PtyManager {
    panes: Mutex<HashMap<PaneId, Pane>>,
    next_id: AtomicU64,
    /// Detached escalation threads started by `kill` (grace wait + SIGKILL).
    /// `kill_all` joins them so a quit right after a pane close still force-
    /// kills that pane's stragglers.
    killers: Mutex<Vec<JoinHandle<()>>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            panes: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            killers: Mutex::new(Vec::new()),
        }
    }

    /// Number of live panes currently in the registry.
    pub fn live_count(&self) -> usize {
        self.panes.lock().unwrap().len()
    }

    /// Spawn a PTY-backed process and stream its output through `sink`.
    ///
    /// `sink` is called from the dedicated read thread for every `PtyEvent`
    /// (batched `Data`, then a final `Exit`). It returns `Err(())` when the
    /// downstream consumer is gone (e.g. the Tauri `Channel` was closed), which
    /// stops the read loop. In production the sink is a closure over a
    /// `Channel<PtyEvent>`; in tests it is a closure over an `mpsc::Sender`.
    ///
    /// Returns the new `PaneId`. The blocking read happens on a dedicated
    /// `std::thread`, so this returns immediately.
    pub fn spawn_with_sink<S>(&self, cfg: SpawnConfig, sink: S) -> Result<PaneId, String>
    where
        S: FnMut(PtyEvent) -> Result<(), ()> + Send + 'static,
    {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: cfg.rows,
                cols: cfg.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        // Build the command with cwd + a seeded environment so `claude` (and
        // its child tools) resolve despite the sparse env macOS GUI apps
        // inherit.
        let mut cmd = CommandBuilder::new(&cfg.program);
        cmd.args(&cfg.args);
        if let Some(cwd) = &cfg.cwd {
            cmd.cwd(cwd);
        }
        seed_env(&mut cmd);
        // Caller-supplied env wins: applied AFTER the seeded base so an explicit
        // override (or a `claude` pane's AGENT_DESKTOP_PANE/SNAPSHOT_DIR) takes
        // precedence over any seeded key of the same name.
        for (key, val) in &cfg.env {
            cmd.env(key, val);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn_command failed: {e}"))?;

        // REQUIRED: drop the slave so the kernel delivers EOF on the master
        // reader once the child exits and no slave fd remains.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_reader failed: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer failed: {e}"))?;
        let killer = child.clone_killer();
        let pid = child.process_id();
        let reaped = Arc::new(AtomicBool::new(false));
        let child = FlaggedChild {
            inner: child,
            reaped: Arc::clone(&reaped),
        };

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        // Dedicated native thread for the blocking read loop. A blocked `read`
        // must never run on the async runtime.
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || {
                read_loop(reader, child, sink);
            })
            .map_err(|e| format!("failed to spawn reader thread: {e}"))?;

        let pane = Pane {
            master: pair.master,
            writer,
            killer,
            pid,
            reaped,
            reader: Some(reader_handle),
        };
        self.panes.lock().unwrap().insert(id, pane);
        Ok(id)
    }

    /// Forward raw input bytes to a pane's PTY writer. Errors (without panic) if
    /// the pane does not exist.
    pub fn write(&self, id: PaneId, data: Vec<u8>) -> Result<(), String> {
        let mut panes = self.panes.lock().unwrap();
        let pane = panes
            .get_mut(&id)
            .ok_or_else(|| format!("no live pane with id {id}"))?;
        pane.writer
            .write_all(&data)
            .map_err(|e| format!("write failed: {e}"))?;
        pane.writer
            .flush()
            .map_err(|e| format!("flush failed: {e}"))?;
        Ok(())
    }

    /// Resize a pane's PTY (delivers SIGWINCH to the child). Rejects 0×0 and a
    /// nonexistent pane without panicking.
    pub fn resize(&self, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Err(format!("refusing zero-sized resize ({cols}x{rows})"));
        }
        let panes = self.panes.lock().unwrap();
        let pane = panes
            .get(&id)
            .ok_or_else(|| format!("no live pane with id {id}"))?;
        pane.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }

    /// Query the kernel's current winsize for a pane (used by tests to confirm
    /// the resize round-trip).
    pub fn get_size(&self, id: PaneId) -> Result<PtySize, String> {
        let panes = self.panes.lock().unwrap();
        let pane = panes
            .get(&id)
            .ok_or_else(|| format!("no live pane with id {id}"))?;
        pane.master
            .get_size()
            .map_err(|e| format!("get_size failed: {e}"))
    }

    /// Kill a pane's ENTIRE process tree — the direct child plus everything it
    /// spawned, including processes that ignore hangup or moved to their own
    /// process group — AND remove the pane from the registry so its
    /// master/writer fds are dropped (closing them) rather than leaking until
    /// quit. The read loop then observes EOF and reaps the child. A no-op
    /// (returns `Ok`) if the pane does not exist.
    ///
    /// Ordering matters: the process table is snapshotted and the graceful
    /// signals are sent BEFORE the pane (and so the PTY) is dropped. Dropping
    /// the writer sends the child `^D`, and an interactive shell exits on EOF
    /// without hanging up its jobs — those jobs must already be tracked and
    /// signalled by then. The grace wait + forced kill then run on a detached
    /// thread (joined by `kill_all`), so this returns promptly.
    ///
    /// If the child already exited on its own (the read loop reaped it), no
    /// signal is sent at all: its pid may by now belong to an unrelated process.
    ///
    /// The pane is REMOVED from the map while the lock is held, then killed after
    /// the lock is released (mirroring `kill_all`'s single-id semantics — we never
    /// hold the registry lock while operating on the killer / joining a reader).
    pub fn kill(&self, id: PaneId) -> Result<(), String> {
        let pane = self.panes.lock().unwrap().remove(&id);
        let Some(mut pane) = pane else {
            return Ok(()); // absent: nothing to kill (idempotent).
        };
        if pane.reaped.load(Ordering::SeqCst) {
            return Ok(()); // already exited; dropping `pane` releases the fds.
        }
        let Some(pid) = pane.pid else {
            return pane.killer.kill().map_err(|e| format!("kill failed: {e}"));
        };
        let trees = process_tree::begin(&[pid]);
        // Now the PTY may go: drop the fds (EOF to anything still reading).
        drop(pane);
        let spawned = std::thread::Builder::new()
            .name(format!("pty-killer-{id}"))
            .spawn(move || process_tree::finish(trees, KILL_GRACE));
        match spawned {
            Ok(handle) => self.killers.lock().unwrap().push(handle),
            // No thread: escalate inline rather than leave stragglers.
            Err(_) => process_tree::finish(process_tree::begin_noop(&[pid]), KILL_GRACE),
        }
        Ok(())
    }

    /// Kill every live pane's whole process tree and reap the direct children
    /// (wired into Tauri `CloseRequested`), so no zombie or orphan processes
    /// remain. Synchronous: when this returns every tree we could see has been
    /// signalled, given [`KILL_ALL_GRACE`], and force-killed if still alive.
    pub fn kill_all(&self) {
        // Drain the registry so each pane is dropped (joining its reader) after
        // its tree is killed.
        let drained: Vec<(PaneId, Pane)> = {
            let mut panes = self.panes.lock().unwrap();
            panes.drain().collect()
        };
        // One process-table snapshot for every pane, and all graceful signals
        // sent, BEFORE any PTY is dropped (see `kill` for why).
        let roots: Vec<u32> = drained
            .iter()
            .filter(|(_, p)| !p.reaped.load(Ordering::SeqCst))
            .filter_map(|(_, p)| p.pid)
            .collect();
        let trees = process_tree::begin(&roots);
        let mut readers = Vec::new();
        for (_id, mut pane) in drained {
            if pane.pid.is_none() && !pane.reaped.load(Ordering::SeqCst) {
                let _ = pane.killer.kill();
            }
            if let Some(h) = pane.reader.take() {
                readers.push(h);
            }
            // Dropping the pane closes the master + writer fds now, so a child
            // blocked on the tty gets EOF while its tree is being torn down.
            drop(pane);
        }
        // Stragglers from earlier single-pane closes get their forced kill too.
        let pending: Vec<JoinHandle<()>> = std::mem::take(&mut *self.killers.lock().unwrap());
        process_tree::finish(trees, KILL_ALL_GRACE);
        let deadline = Instant::now() + READER_JOIN_TIMEOUT;
        for h in pending.into_iter().chain(readers) {
            join_within(h, deadline);
        }
    }

    /// Wait up to `timeout` for a pane's read thread to terminate. Returns
    /// `true` if it finished within the timeout. Removes the pane from the
    /// registry. Used by tests to assert the loop stops when its channel is
    /// gone.
    pub fn join_reader(&self, id: PaneId, timeout: Duration) -> bool {
        let handle = {
            let mut panes = self.panes.lock().unwrap();
            match panes.remove(&id) {
                Some(mut pane) => pane.reader.take(),
                None => return true,
            }
        };
        let Some(handle) = handle else {
            return true;
        };
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if handle.is_finished() {
                let _ = handle.join();
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }
}

/// Seed the child environment. Always sets `TERM`/`COLORTERM`; for `PATH` we use
/// the resolved login-shell PATH (see [`crate::shell_path`]) so `claude` is
/// discoverable even from the sparse env a Finder-launched GUI app inherits.
fn seed_env(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    cmd.env("PATH", crate::shell_path::resolved_path());

    // `HOME` on Unix, `USERPROFILE` on Windows — see `shell_path::home_dir`.
    let home = crate::shell_path::home_dir();
    if !home.is_empty() {
        cmd.env("HOME", home);
    }

    let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string());
    cmd.env("LANG", lang);
}

/// A chunk produced by the inner blocking reader thread.
enum ReadChunk {
    /// Bytes read from the PTY master.
    Data(Vec<u8>),
    /// The reader hit EOF (child exited and no slave fd remains).
    Eof,
    /// The reader hit a non-recoverable I/O error (e.g. pty torn down).
    Err,
}

/// The read loop: ship raw, ordered PTY output through `sink` as
/// `PtyEvent::Data`, coalescing bursts into ~`MAX_LATENCY` / up to `MAX_BATCH`
/// batches. On EOF reap the child via `child.wait()` and emit
/// `PtyEvent::Exit{code}`. Stops early if `sink` reports the consumer is gone.
///
/// The blocking `read` runs on a dedicated inner thread that feeds chunks over
/// a bounded channel; the outer coalescer drives flush cadence with
/// `recv_timeout(MAX_LATENCY)`. This is required because a blocking `read`
/// cannot otherwise honor a time-based flush deadline: a small burst followed
/// by an idle child (the normal interactive-TUI case) would otherwise strand
/// the pending batch until the next output.
///
/// Generic over the child handle so tests and production share the exact code
/// path. `reader` is any `Read + Send`; `child` is any `ReapableChild`.
fn read_loop<R, C, S>(mut reader: R, mut child: C, mut sink: S)
where
    R: Read + Send + 'static,
    C: ReapableChild,
    S: FnMut(PtyEvent) -> Result<(), ()>,
{
    // Bounded so a slow consumer cannot let the producer grow memory without
    // limit; the producer blocks on a full channel (best-effort backpressure
    // to the kernel pipe buffer).
    let (tx, rx) = std::sync::mpsc::sync_channel::<ReadChunk>(64);
    let producer = std::thread::Builder::new()
        .name("pty-reader-inner".into())
        .spawn(move || {
            let mut read_buf = [0u8; READ_CHUNK];
            loop {
                match reader.read(&mut read_buf) {
                    Ok(0) => {
                        let _ = tx.send(ReadChunk::Eof);
                        return;
                    }
                    Ok(n) => {
                        if tx.send(ReadChunk::Data(read_buf[..n].to_vec())).is_err() {
                            // Consumer gone; stop reading.
                            return;
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => {
                        let _ = tx.send(ReadChunk::Err);
                        return;
                    }
                }
            }
        })
        .expect("failed to spawn inner pty reader thread");

    let mut batch: Vec<u8> = Vec::with_capacity(MAX_BATCH);

    // Flush the pending batch through the sink. Returns false if the consumer
    // is gone (caller should stop).
    macro_rules! flush {
        () => {{
            if !batch.is_empty() {
                let payload = std::mem::take(&mut batch);
                if sink(PtyEvent::Data { bytes: payload }).is_err() {
                    false
                } else {
                    true
                }
            } else {
                true
            }
        }};
    }

    loop {
        match rx.recv_timeout(MAX_LATENCY) {
            Ok(ReadChunk::Data(bytes)) => {
                batch.extend_from_slice(&bytes);
                // Flush eagerly once the batch reaches the size cap; otherwise
                // keep coalescing until the latency deadline (a recv timeout).
                if batch.len() >= MAX_BATCH && !flush!() {
                    // Consumer gone: stop. The producer unblocks when the pane
                    // is killed (ordered teardown / kill_all) and observes the
                    // dropped receiver below.
                    break;
                }
            }
            Ok(ReadChunk::Eof) | Ok(ReadChunk::Err) => {
                let _ = flush!();
                let code = child.reap();
                let _ = sink(PtyEvent::Exit { code });
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // Latency deadline: flush whatever we have so idle output is
                // not stranded behind a blocking read.
                if !flush!() {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                // Producer ended without an explicit marker (e.g. its send of
                // Eof/Err is what closed the channel after we already consumed
                // it). Reap and surface Exit.
                let _ = flush!();
                let code = child.reap();
                let _ = sink(PtyEvent::Exit { code });
                break;
            }
        }
    }

    // Drop the receiver so a producer still blocked in `read` will fail its
    // next send and unwind; then join it so the thread does not leak.
    drop(rx);
    let _ = producer.join();
}

/// Join `handle` if it finishes before `deadline`; otherwise leave it running
/// (it is detached, not leaked: it ends on its own once its fds close).
fn join_within(handle: JoinHandle<()>, deadline: Instant) {
    while Instant::now() < deadline {
        if handle.is_finished() {
            let _ = handle.join();
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if handle.is_finished() {
        let _ = handle.join();
    }
}

/// Minimal interface the read loop needs to reap a child: block until it exits
/// and return its exit code. Abstracted so the loop is unit-testable without a
/// real process.
trait ReapableChild {
    fn reap(&mut self) -> i32;
}

/// Wraps a child so the pane learns the instant it has been reaped (after
/// which its pid is no longer ours to signal).
struct FlaggedChild<C> {
    inner: C,
    reaped: Arc<AtomicBool>,
}

impl<C: ReapableChild> ReapableChild for FlaggedChild<C> {
    fn reap(&mut self) -> i32 {
        let code = self.inner.reap();
        self.reaped.store(true, Ordering::SeqCst);
        code
    }
}

impl ReapableChild for Box<dyn portable_pty::Child + Send + Sync> {
    fn reap(&mut self) -> i32 {
        match self.wait() {
            Ok(status) => status.exit_code() as i32,
            Err(_) => -1,
        }
    }
}


/// Whole-process-tree termination for a pane.
///
/// `portable-pty`'s `ChildKiller` only signals the direct child (SIGHUP on
/// Unix, `TerminateProcess` on Windows). Everything the child started — build
/// servers, `nohup`'d jobs, agents' tool subprocesses, anything that trapped
/// HUP or moved to its own process group — would otherwise outlive the pane.
///
/// Two-phase: [`begin`] snapshots the process table, records every member of
/// each tree (pids AND their process groups, so a job that is reparented to
/// init after its shell dies is still found) and sends the graceful signals;
/// [`finish`] waits a grace period and SIGKILLs whatever is left. The split
/// lets the caller send signals before the PTY is torn down, then escalate
/// off-thread.
///
/// Pid-reuse safety: a root is only accepted if the process table shows it as
/// a live child of THIS process; a pid or group id `<= 1` is never signalled.
pub mod process_tree {
    use std::collections::HashSet;
    use std::time::{Duration, Instant};

    /// The set of processes belonging to one pane, as tracked across the
    /// escalation. Cloneable so a caller can hand it to a thread.
    #[derive(Debug, Clone)]
    pub struct Tree {
        root: u32,
        /// Every pid ever observed in the tree. Kept even after a member dies
        /// (its descendants may still be alive, and `ps` no longer links them).
        tracked: HashSet<u32>,
        /// Every process-group id observed on a tracked member. A job under
        /// job control leads its own group; signalling the group reaches its
        /// helpers even if they were forked after our last look.
        groups: HashSet<u32>,
        /// True if the process table could not be read: fall back to the
        /// root + its group and skip the "already dead" early exit.
        blind: bool,
    }

    /// A row of the process table.
    #[cfg(unix)]
    #[derive(Debug, Clone, Copy)]
    struct Proc {
        pid: u32,
        ppid: u32,
        pgid: u32,
        zombie: bool,
    }

    /// Snapshot the process table via `ps` (portable across macOS and Linux;
    /// no /proc dependency). `None` if `ps` is missing or rejects the flags.
    #[cfg(unix)]
    fn snapshot() -> Option<Vec<Proc>> {
        let out = std::process::Command::new("ps")
            .args(["-axo", "pid=,ppid=,pgid=,stat="])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let rows: Vec<Proc> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let mut it = line.split_whitespace();
                let pid = it.next()?.parse().ok()?;
                let ppid = it.next()?.parse().ok()?;
                let pgid = it.next()?.parse().ok()?;
                let zombie = it.next().is_some_and(|s| s.starts_with('Z'));
                Some(Proc { pid, ppid, pgid, zombie })
            })
            .collect();
        (!rows.is_empty()).then_some(rows)
    }

    #[cfg(unix)]
    impl Tree {
        /// Build the tree rooted at `root` from `procs`. `None` unless `root`
        /// is a live child of the calling process — the guard against a pid
        /// that was recycled after our child exited.
        fn discover(root: u32, procs: &[Proc]) -> Option<Tree> {
            let me = std::process::id();
            let row = procs.iter().find(|q| q.pid == root)?;
            if row.ppid != me || row.zombie {
                return None;
            }
            let mut tree = Tree {
                root,
                tracked: HashSet::new(),
                groups: HashSet::new(),
                blind: false,
            };
            tree.absorb(procs);
            Some(tree)
        }

        /// Without a process table we can still hang up the leader and its
        /// own group (everything that never left it).
        fn blind(root: u32) -> Tree {
            Tree {
                root,
                tracked: HashSet::from([root]),
                groups: HashSet::from([root]),
                blind: true,
            }
        }

        /// Fold `procs` into the tracked set: descendants (by parent chain from
        /// any tracked pid) and members of any tracked group. Returns the pids
        /// among them that are alive right now.
        fn absorb(&mut self, procs: &[Proc]) -> Vec<u32> {
            self.tracked.insert(self.root);
            // Iterate to a fixpoint: descendants reveal new groups, and group
            // members (e.g. an orphan reparented to init) reveal new
            // descendants.
            loop {
                let before = self.tracked.len();
                let mut frontier: Vec<u32> = self.tracked.iter().copied().collect();
                while let Some(p) = frontier.pop() {
                    for q in procs.iter().filter(|q| q.ppid == p) {
                        if self.tracked.insert(q.pid) {
                            frontier.push(q.pid);
                        }
                    }
                }
                for q in procs.iter().filter(|q| self.tracked.contains(&q.pid)) {
                    self.groups.insert(q.pgid);
                }
                for q in procs.iter().filter(|q| self.groups.contains(&q.pgid)) {
                    self.tracked.insert(q.pid);
                }
                if self.tracked.len() == before {
                    break;
                }
            }
            procs
                .iter()
                .filter(|q| !q.zombie && self.tracked.contains(&q.pid))
                .map(|q| q.pid)
                .collect()
        }

        /// Live tracked pids per the current process table, absorbing any new
        /// arrivals. `None` if the table cannot be read.
        fn live(&mut self) -> Option<Vec<u32>> {
            snapshot().map(|procs| self.absorb(&procs))
        }

        /// SIGHUP to the leader (what closing a real terminal sends; shells
        /// forward it to their jobs) and SIGTERM to everyone else, individually
        /// and by group.
        fn signal_graceful(&self) {
            signal(self.root, libc::SIGHUP);
            for &pid in self.tracked.iter().filter(|&&p| p != self.root) {
                signal(pid, libc::SIGTERM);
            }
            for &g in &self.groups {
                signal_group(g, libc::SIGTERM);
            }
        }

        /// SIGKILL `pids` and every tracked group.
        fn signal_kill(&self, pids: &[u32]) {
            for &pid in pids {
                signal(pid, libc::SIGKILL);
            }
            for &g in &self.groups {
                signal_group(g, libc::SIGKILL);
            }
        }
    }

    /// Phase 1: one process-table snapshot, then discover every tree and send
    /// its graceful signals. Roots that are not our live children are skipped
    /// (their pid is stale). Call this BEFORE dropping the PTY.
    #[cfg(unix)]
    pub fn begin(roots: &[u32]) -> Vec<Tree> {
        let procs = snapshot();
        let trees: Vec<Tree> = roots
            .iter()
            .filter(|&&r| r > 1)
            .filter_map(|&root| match &procs {
                Some(procs) => Tree::discover(root, procs),
                None => Some(Tree::blind(root)),
            })
            .collect();
        for t in &trees {
            t.signal_graceful();
        }
        trees
    }

    /// Like [`begin`] but assumes the graceful signals were already sent
    /// (used when re-planning after a thread-spawn failure).
    #[cfg(unix)]
    pub fn begin_noop(roots: &[u32]) -> Vec<Tree> {
        let procs = snapshot();
        roots
            .iter()
            .filter(|&&r| r > 1)
            .filter_map(|&root| match &procs {
                Some(procs) => Tree::discover(root, procs),
                None => Some(Tree::blind(root)),
            })
            .collect()
    }

    /// Phase 2: give the trees `grace` to exit, then SIGKILL every survivor
    /// (re-reading the table each poll so late-spawned children are caught).
    #[cfg(unix)]
    pub fn finish(mut trees: Vec<Tree>, grace: Duration) {
        if trees.is_empty() {
            return;
        }
        let deadline = Instant::now() + grace;
        loop {
            std::thread::sleep(Duration::from_millis(40));
            let mut any_alive = false;
            for t in trees.iter_mut() {
                match t.live() {
                    Some(live) if live.is_empty() => {}
                    // Unreadable table: assume alive until the deadline.
                    Some(_) | None => any_alive = true,
                }
            }
            if !any_alive || Instant::now() >= deadline {
                break;
            }
        }
        for t in trees.iter_mut() {
            let survivors = match t.live() {
                Some(live) => live,
                // Blind: SIGKILL everything we ever tracked (root + group).
                None => t.tracked.iter().copied().collect(),
            };
            if survivors.is_empty() && !t.blind {
                continue;
            }
            t.signal_kill(&survivors);
        }
    }

    /// `taskkill /T` walks the child tree and `/F` forces termination. Windows
    /// recycles pids fast, so the caller's "already reaped" guard matters here.
    #[cfg(windows)]
    pub fn begin(roots: &[u32]) -> Vec<Tree> {
        use crate::no_window::NoConsoleWindow;
        for &root in roots.iter().filter(|&&r| r > 1) {
            let _ = std::process::Command::new("taskkill")
                .args(["/T", "/F", "/PID", &root.to_string()])
                .no_console_window()
                .output();
        }
        Vec::new()
    }

    #[cfg(windows)]
    pub fn begin_noop(_roots: &[u32]) -> Vec<Tree> {
        Vec::new()
    }

    #[cfg(windows)]
    pub fn finish(_trees: Vec<Tree>, _grace: Duration) {}

    /// Signal one pid. Never pid 0/1 (or negatives): `kill(0, …)` hits our
    /// own group and `kill(-1, …)` every process we own.
    #[cfg(unix)]
    fn signal(pid: u32, sig: libc::c_int) {
        if pid <= 1 {
            return;
        }
        // ESRCH (already gone) and EPERM are both fine to ignore here.
        unsafe {
            libc::kill(pid as libc::pid_t, sig);
        }
    }

    /// Signal every process in the group whose id is `pgid`.
    #[cfg(unix)]
    fn signal_group(pgid: u32, sig: libc::c_int) {
        if pgid <= 1 {
            return;
        }
        unsafe {
            libc::kill(-(pgid as libc::pid_t), sig);
        }
    }

    #[cfg(all(test, unix))]
    mod tests {
        use super::*;

        fn row(pid: u32, ppid: u32, pgid: u32) -> Proc {
            Proc { pid, ppid, pgid, zombie: false }
        }

        #[test]
        fn discover_rejects_a_pid_that_is_not_our_live_child() {
            let me = std::process::id();
            // Our own pid: its parent is not us → stale/recycled → rejected.
            let table = vec![row(me, 1, me), row(4242, 1, 4242)];
            assert!(Tree::discover(me, &table).is_none());
            assert!(Tree::discover(4242, &table).is_none());
            // A zombie child is already dead: nothing to signal.
            let mut z = row(4243, me, 4243);
            z.zombie = true;
            assert!(Tree::discover(4243, &[z]).is_none());
        }

        #[test]
        fn discover_tracks_descendants_and_their_process_groups() {
            let me = std::process::id();
            // root(100) → job(101, own group) → helper(102 in job's group);
            // orphan(103) already reparented to init but still in root's group.
            let table = vec![
                row(100, me, 100),
                row(101, 100, 101),
                row(102, 101, 101),
                row(103, 1, 100),
                row(999, 1, 999), // unrelated
            ];
            let tree = Tree::discover(100, &table).expect("root is our child");
            assert_eq!(tree.tracked, HashSet::from([100, 101, 102, 103]));
            assert_eq!(tree.groups, HashSet::from([100, 101]));
        }

        #[test]
        fn absorb_keeps_reparented_jobs_after_the_root_dies() {
            let me = std::process::id();
            let mut tree = Tree::discover(100, &[row(100, me, 100), row(101, 100, 101)]).unwrap();
            // Root gone; job reparented to init in its own group, and it has
            // since forked a grandchild.
            let later = vec![row(101, 1, 101), row(105, 101, 101)];
            let live = tree.absorb(&later);
            assert_eq!(live.len(), 2);
            assert!(tree.tracked.contains(&105));
        }

        #[test]
        fn begin_ignores_pids_we_must_never_signal() {
            // 0, 1 and our own pid: nothing is discovered, nothing signalled.
            assert!(begin(&[0, 1, std::process::id()]).is_empty());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::mpsc;

    /// Test double for `ReapableChild` so the read loop can be unit-tested
    /// without spawning a process.
    struct FakeChild {
        code: i32,
    }
    impl ReapableChild for FakeChild {
        fn reap(&mut self) -> i32 {
            self.code
        }
    }

    /// The read loop coalesces a burst, preserves bytes/order, and ends with an
    /// Exit carrying the reaped code.
    #[test]
    fn read_loop_batches_and_emits_exit() {
        let payload = vec![b'z'; 200 * 1024];
        let reader = Cursor::new(payload.clone());
        let child = FakeChild { code: 0 };
        let (tx, rx) = mpsc::channel();

        read_loop(reader, child, move |ev| tx.send(ev).map_err(|_| ()));

        let mut data = Vec::new();
        let mut exit = None;
        while let Ok(ev) = rx.try_recv() {
            match ev {
                PtyEvent::Data { bytes } => data.extend_from_slice(&bytes),
                PtyEvent::Exit { code } => exit = Some(code),
            }
        }
        assert_eq!(
            data, payload,
            "bytes must be preserved exactly and in order"
        );
        assert_eq!(exit, Some(0));
    }

    /// A short payload (no newline) is forwarded verbatim with an Exit code.
    #[test]
    fn read_loop_forwards_small_payload_verbatim() {
        let reader = Cursor::new(b"hi there".to_vec());
        let child = FakeChild { code: 3 };
        let (tx, rx) = mpsc::channel();

        read_loop(reader, child, move |ev| tx.send(ev).map_err(|_| ()));

        let mut data = Vec::new();
        let mut exit = None;
        while let Ok(ev) = rx.try_recv() {
            match ev {
                PtyEvent::Data { bytes } => data.extend_from_slice(&bytes),
                PtyEvent::Exit { code } => exit = Some(code),
            }
        }
        assert_eq!(data, b"hi there");
        assert_eq!(exit, Some(3));
    }

    /// PtyEvent serializes to the documented tagged JSON shape the frontend
    /// depends on.
    #[test]
    fn pty_event_json_shape_is_stable() {
        let data = serde_json::to_value(PtyEvent::Data {
            bytes: vec![1, 2, 255],
        })
        .unwrap();
        assert_eq!(data["event"], "data");
        assert_eq!(data["bytes"], serde_json::json!([1, 2, 255]));

        let exit = serde_json::to_value(PtyEvent::Exit { code: 0 }).unwrap();
        assert_eq!(exit["event"], "exit");
        assert_eq!(exit["code"], 0);
    }
}
