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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// Handle to the dedicated read-loop thread, so we can join on teardown.
    reader: Option<JoinHandle<()>>,
}

/// Tauri-managed state: a registry of live panes plus a monotonic id counter.
pub struct PtyManager {
    panes: Mutex<HashMap<PaneId, Pane>>,
    next_id: AtomicU64,
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

    /// Kill a pane's child via its cloned killer (callable from any thread) AND
    /// remove the pane from the registry so its master/writer fds are dropped
    /// (closing them) rather than leaking until quit. The read loop then observes
    /// EOF and reaps the child. A no-op (returns `Ok`) if the pane does not exist.
    ///
    /// The pane is REMOVED from the map while the lock is held, then killed after
    /// the lock is released (mirroring `kill_all`'s single-id semantics — we never
    /// hold the registry lock while operating on the killer / joining a reader).
    pub fn kill(&self, id: PaneId) -> Result<(), String> {
        let pane = self.panes.lock().unwrap().remove(&id);
        let Some(mut pane) = pane else {
            return Ok(()); // absent: nothing to kill (idempotent).
        };
        let result = pane.killer.kill().map_err(|e| format!("kill failed: {e}"));
        // Dropping `pane` here closes the master + writer fds. We do NOT join the
        // reader thread (it unwinds on its own once the master is gone); this also
        // avoids holding anything across a join.
        result
    }

    /// Kill and reap every live pane (wired into Tauri `CloseRequested`), so no
    /// zombie or orphan processes remain.
    pub fn kill_all(&self) {
        // Drain the registry so each pane is dropped (joining its reader) after
        // its child is killed.
        let drained: Vec<(PaneId, Pane)> = {
            let mut panes = self.panes.lock().unwrap();
            panes.drain().collect()
        };
        for (_id, mut pane) in drained {
            let _ = pane.killer.kill();
            if let Some(handle) = pane.reader.take() {
                let _ = handle.join();
            }
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

    if let Ok(home) = std::env::var("HOME") {
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

/// Minimal interface the read loop needs to reap a child: block until it exits
/// and return its exit code. Abstracted so the loop is unit-testable without a
/// real process.
trait ReapableChild {
    fn reap(&mut self) -> i32;
}

impl ReapableChild for Box<dyn portable_pty::Child + Send + Sync> {
    fn reap(&mut self) -> i32 {
        match self.wait() {
            Ok(status) => status.exit_code() as i32,
            Err(_) => -1,
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
