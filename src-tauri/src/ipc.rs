//! Cross-platform local-socket addressing shared by the event socket
//! ([`crate::events`]) and the orchestration control socket
//! ([`crate::orchestration`]).
//!
//! Both servers accept one JSON payload per connection from a Node client that
//! connects with `net.createConnection({ path })`. On macOS/Linux that path is a
//! Unix-domain socket in the app-data dir; on Windows it is a named pipe. This
//! module owns the ONE place that difference is expressed.
//!
//! Two properties make this safe to share:
//!
//! 1. **`GenericFilePath` accepts both forms.** On Unix it is a filesystem path;
//!    on Windows it passes a `\\.\pipe\…` path through verbatim. So we build the
//!    complete address string ourselves and hand the SAME string to both the
//!    listener and (via the launch env) the Node client — there is no way for the
//!    two to disagree about where the socket lives.
//! 2. **Named pipes die with their process.** A Unix socket file outlives a crash
//!    and must be unlinked before re-binding; a named pipe cannot be left behind
//!    by a dead process. The only way to collide is with a LIVE second instance,
//!    which genuinely wants a socket of its own — hence the pid in the name.

use std::io;
use std::path::Path;

use interprocess::local_socket::traits::Stream as _;
use interprocess::local_socket::{GenericFilePath, ListenerOptions, ToFsName};

/// The listener type both servers accept connections on.
pub type Listener = interprocess::local_socket::Listener;

/// Brings [`Listener::incoming`] into scope. Re-exported so the servers import
/// their whole socket vocabulary from this module and never name `interprocess`
/// directly — keeping the transport swappable from one place.
pub use interprocess::local_socket::traits::ListenerExt;

/// One accepted connection. Implements `Read`/`Write` — including for `&Stream`,
/// which lets a connection be read and written without duplicating the handle.
pub use interprocess::local_socket::Stream;

/// FNV-1a over the socket's full path. Disambiguates two sockets that share a
/// basename (`events.sock` under different app-data roots, or under two temp dirs
/// in concurrent tests) — the pid alone cannot, since those live in one process.
fn path_hash(path: &Path) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in path.to_string_lossy().as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Derive the address for `path`, as if on Windows when `windows` is true.
///
/// Split out from [`socket_address`] so BOTH platform branches are unit-testable
/// from any host — the Windows naming rule is pure string logic and does not need
/// a Windows machine to verify.
fn address_for(path: &Path, windows: bool, pid: u32) -> String {
    if !windows {
        return path.to_string_lossy().into_owned();
    }
    format!(
        r"\\.\pipe\agent-desktop-{}-{:08x}-{pid}",
        pipe_stem(path),
        path_hash(path)
    )
}

/// `…/events.sock` -> `events`; keeps the pipe name readable in Process Explorer.
///
/// Deliberately does NOT use `Path::file_stem`: `std::path` interprets separators
/// per the HOST, so a `\`-separated Windows path parsed on macOS has no
/// components and the entire path would land in the pipe name. Splitting on both
/// separators keeps this function's result identical on every host, which is what
/// makes the Windows branch meaningfully testable from a Mac.
fn pipe_stem(path: &Path) -> String {
    let full = path.to_string_lossy();
    let base = full
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or("");
    let stem = base.rsplit_once('.').map(|(head, _)| head).unwrap_or(base);
    // A pipe name is a single NPFS component: anything that could be read as a
    // separator, drive letter, or wildcard is replaced rather than passed through.
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    if cleaned.is_empty() {
        "socket".to_string()
    } else {
        cleaned
    }
}

/// The address to bind, and the exact string handed to clients via the launch env
/// (`AGENT_DESKTOP_SOCKET_PATH` / `AGENT_DESKTOP_CONTROL_SOCKET`).
///
/// Deterministic within a process, so the server and the env agree by construction.
pub fn socket_address(path: &Path) -> String {
    address_for(path, cfg!(windows), std::process::id())
}

/// Bind a listener at `address`.
///
/// On Unix a leftover socket file from a crashed run makes `bind` fail with
/// `AddrInUse`, so it is unlinked first — the long-standing behavior. On Windows
/// there is nothing to unlink (see the module docs), and `address` is a pipe name
/// rather than a filesystem path, so no unlink is attempted.
pub fn bind_listener(address: &str) -> io::Result<Listener> {
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(address);
    }
    let name = address.to_fs_name::<GenericFilePath>()?;
    ListenerOptions::new().name(name).create_sync()
}

/// Connect to a local socket at `address`. Used by the servers' own tests and by
/// any in-process client; the production clients are the Node hook and adapter.
pub fn connect(address: &str) -> io::Result<Stream> {
    let name = address.to_fs_name::<GenericFilePath>()?;
    Stream::connect(name)
}

/// Remove a bound socket's filesystem entry on teardown. A no-op on Windows,
/// where the pipe is released with the listener and has no path to unlink.
pub fn cleanup_address(address: &str) {
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(address);
    }
    #[cfg(not(unix))]
    {
        let _ = address;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// On Unix the address is the socket path verbatim — the pre-existing
    /// behavior, so nothing about macOS/Linux delivery changes.
    #[test]
    fn unix_address_is_the_socket_path() {
        let p = PathBuf::from("/Users/x/Library/App/events.sock");
        assert_eq!(
            address_for(&p, false, 4242),
            "/Users/x/Library/App/events.sock"
        );
    }

    /// On Windows the address is a `\\.\pipe\` name, which is what both the
    /// listener and Node's `createConnection({ path })` require.
    #[test]
    fn windows_address_is_a_named_pipe() {
        let p = PathBuf::from(r"C:\Users\x\AppData\Roaming\agent-desktop\events.sock");
        let addr = address_for(&p, true, 4242);
        assert!(
            addr.starts_with(r"\\.\pipe\agent-desktop-events-"),
            "unexpected pipe name: {addr}"
        );
        assert!(addr.ends_with("-4242"), "pid not in name: {addr}");
        // No filesystem path leaks into the pipe name.
        assert!(!addr.contains('/'), "path leaked: {addr}");
        assert!(!addr.contains("AppData"), "path leaked: {addr}");
    }

    /// The events and control sockets must never collide on Windows: they share a
    /// process (same pid) and differ only by basename.
    #[test]
    fn windows_events_and_control_addresses_differ() {
        let dir = PathBuf::from(r"C:\app");
        let events = address_for(&dir.join("events.sock"), true, 7);
        let control = address_for(&dir.join("control.sock"), true, 7);
        assert_ne!(events, control);
    }

    /// Two live app instances must not fight over one pipe name.
    #[test]
    fn windows_address_is_unique_per_process() {
        let p = PathBuf::from(r"C:\app\events.sock");
        assert_ne!(address_for(&p, true, 1), address_for(&p, true, 2));
    }

    /// Same basename under different roots (two installs, or two concurrent
    /// tests in ONE process where the pid cannot disambiguate) must not collide.
    #[test]
    fn windows_address_is_unique_per_path() {
        let a = address_for(Path::new(r"C:\a\events.sock"), true, 7);
        let b = address_for(Path::new(r"C:\b\events.sock"), true, 7);
        assert_ne!(a, b);
    }

    /// A path with no usable stem still yields a legal pipe name.
    #[test]
    fn windows_address_tolerates_a_stemless_path() {
        let addr = address_for(Path::new(r"C:\app\"), true, 7);
        assert!(addr.starts_with(r"\\.\pipe\agent-desktop-"), "{addr}");
    }

    /// The address is stable within a process, so the bound socket and the value
    /// exported to clients cannot drift apart.
    #[test]
    fn socket_address_is_stable_within_a_process() {
        let p = PathBuf::from("/tmp/agentdesk/events.sock");
        assert_eq!(socket_address(&p), socket_address(&p));
    }
}
