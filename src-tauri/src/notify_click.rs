//! Clickable needs-input notifications (capability `alert-click-focus`).
//!
//! The bundled `tauri-plugin-notification` discards click events on desktop —
//! its macOS path calls `notify_rust`'s `show()` in a spawned task and throws
//! the result away, so no body-click ever reaches JS. The capability exists one
//! layer down: `notify_rust` wraps `mac-notification-sys`, whose
//! `Notification::wait_for_click(true)` blocks and returns
//! [`NotificationResponse::Click`] on a body tap.
//!
//! So on macOS we send the needs-input notification ourselves and, on a click,
//! emit [`ACTIVATED_EVENT`] carrying the alerting agent's `paneId`. The frontend
//! listens for it to raise the window and select that agent. On non-macOS this
//! command is a no-op (the frontend keeps using the plugin send path there).

/// Event emitted to the frontend when a needs-input notification is clicked.
/// Payload: `{ paneId }`.
const ACTIVATED_EVENT: &str = "agent-notification-activated";

/// Payload for [`ACTIVATED_EVENT`]: the paneId of the agent whose notification
/// was activated. Serialized as `{ "paneId": "…" }` to match the roster key the
/// frontend's `navigateTarget` consumes.
#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct Activation {
    #[serde(rename = "paneId")]
    pane_id: String,
}

/// Show a needs-input desktop notification for `pane_id` and, on a body click,
/// emit [`ACTIVATED_EVENT`] with that paneId.
///
/// `wait_for_click(true)` makes the send BLOCK until the user interacts with (or
/// the OS dismisses) the notification, so the work runs on a dedicated thread and
/// the command returns immediately. Each notification is independent
/// (`mac-notification-sys` keys pending entries by UUID), so concurrent alerts are
/// safe. Send failures are logged and swallowed — an alert must never throw.
///
/// On non-macOS this is a no-op; the frontend sends via the notification plugin
/// there (no click handling, matching the capability's macOS-only scope).
#[tauri::command]
pub fn notify_agent(app: tauri::AppHandle, pane_id: String, title: String, body: String) {
    #[cfg(target_os = "macos")]
    {
        use mac_notification_sys::{Notification, NotificationResponse};
        use tauri::Emitter;

        std::thread::spawn(move || {
            let response = Notification::new()
                .title(&title)
                .message(&body)
                .wait_for_click(true)
                .send();
            match response {
                // A body tap (contentsClicked) or an action button both mean
                // "take me to this agent".
                Ok(NotificationResponse::Click) | Ok(NotificationResponse::ActionButton(_)) => {
                    app.emit(ACTIVATED_EVENT, Activation { pane_id }).ok();
                }
                Ok(_) => {} // dismissed / closed / no interaction
                Err(e) => log::warn!("notify_agent: failed to send notification: {e}"),
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        // The frontend never invokes this off macOS (it uses the plugin path);
        // kept so the shared command set still builds everywhere.
        let _ = (app, pane_id, title, body);
    }
}
