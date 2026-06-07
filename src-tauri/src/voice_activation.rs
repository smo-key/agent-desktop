//! Native macOS double-tap-right-Command activation for the voice panel.
//!
//! Two layers live here:
//!
//!   * [`DoubleTapDetector`] — a PURE, headless-testable state machine. The
//!     caller feeds it monotonic timestamps of right-Command *presses*; it tells
//!     it whether each press completed a double-tap inside the configured window.
//!     It holds no time source of its own, so its full behaviour is unit-tested.
//!
//!   * [`start`] — the native `NSEvent` monitor (macOS only). It installs both a
//!     GLOBAL and a LOCAL `flagsChanged` monitor, isolates the RIGHT-Command
//!     PRESS (keyCode 54, command flag now set), and on a completed double-tap
//!     emits the `voice://activate` Tauri event the frontend listens for.
//!
//! ## macOS permission caveat (IMPORTANT)
//!
//! A **GLOBAL** `NSEvent` monitor for key/flag events only fires while the app
//! holds **Accessibility / Input-Monitoring** permission (System Settings →
//! Privacy & Security). Without it the global monitor installs successfully but
//! silently never fires, so the double-tap gesture won't work while the app is
//! in the background. The **LOCAL** monitor needs no such permission and still
//! fires while the app is focused. The on-screen mic button is the always-works
//! fallback and is wholly independent of this monitor.
//!
//! `start` is best-effort: any failure is logged and swallowed so the app — and
//! the mic button — keep working. On non-macOS it is a no-op.

/// Pure double-tap state machine. The caller supplies monotonic `now_ms`
/// timestamps; the detector decides whether a press completed a double-tap.
pub struct DoubleTapDetector {
    /// Timestamp (ms) of the previous *unmatched* tap, or `None` when the next
    /// tap would be the first of a potential pair.
    last_ms: Option<u64>,
    /// Maximum gap (ms) between the two taps of a double-tap.
    window_ms: u64,
}

impl DoubleTapDetector {
    /// Build a detector whose two taps must fall within `window_ms` (e.g. 400).
    pub fn new(window_ms: u64) -> Self {
        Self {
            last_ms: None,
            window_ms,
        }
    }

    /// Record a right-Command tap at `now_ms`. Returns `true` iff this tap
    /// completes a double-tap — i.e. a prior unmatched tap exists and the gap is
    /// within `window_ms`. On a `true` result the state is reset so a third quick
    /// tap starts a fresh pair (no immediate re-trigger). Out-of-order clocks
    /// (`now_ms` < the stored tap) are treated as a fresh first tap rather than
    /// underflowing.
    pub fn tap(&mut self, now_ms: u64) -> bool {
        if let Some(last) = self.last_ms {
            if now_ms >= last && now_ms - last <= self.window_ms {
                // Completed a double-tap; reset so a third tap starts fresh.
                self.last_ms = None;
                return true;
            }
        }
        // First tap, too-late tap, or out-of-order clock: arm for the next one.
        self.last_ms = Some(now_ms);
        false
    }
}

/// Install the native double-tap-right-Command monitor (macOS only). Best-effort:
/// any failure is logged and swallowed. No-op on other platforms.
#[cfg(target_os = "macos")]
pub fn start(app: tauri::AppHandle) {
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use tauri::Emitter;

    /// Default double-tap window (ms).
    const WINDOW_MS: u64 = 400;
    /// keyCode 54 = RIGHT Command (55 = left, ignored).
    const RIGHT_COMMAND_KEYCODE: u16 = 54;

    // Monotonic epoch + shared detector. Both closures share one detector so the
    // gesture works regardless of which monitor sees the press.
    let epoch = Instant::now();
    let detector = Arc::new(Mutex::new(DoubleTapDetector::new(WINDOW_MS)));

    // Returns true iff `event` is a RIGHT-Command PRESS (not a release). On a
    // flagsChanged event the command flag being *set* means a press; cleared
    // means a release — we only act on the press edge.
    fn is_right_command_press(event: &NSEvent) -> bool {
        let key_code = event.keyCode();
        if key_code != RIGHT_COMMAND_KEYCODE {
            return false;
        }
        let flags = event.modifierFlags();
        flags.contains(NSEventModifierFlags::Command)
    }

    // Shared handler body: on a right-Command press, tap the detector and emit
    // the activation event when a double-tap completes.
    let on_flags = move |event: &NSEvent, epoch: Instant, app: &tauri::AppHandle, det: &Arc<Mutex<DoubleTapDetector>>| {
        if !is_right_command_press(event) {
            return;
        }
        let now_ms = epoch.elapsed().as_millis() as u64;
        let fired = det
            .lock()
            .map(|mut d| d.tap(now_ms))
            .unwrap_or(false);
        if fired {
            app.emit("voice://activate", ()).ok();
        }
    };

    let mask = NSEventMask::FlagsChanged;

    // GLOBAL monitor: fires while the app is NOT focused (needs Accessibility /
    // Input-Monitoring permission — see module docs). Handler returns void.
    {
        let app = app.clone();
        let det = detector.clone();
        let on_flags = on_flags.clone();
        let handler = block2::RcBlock::new(move |event: core::ptr::NonNull<NSEvent>| {
            // SAFETY: AppKit hands us a valid, autoreleased NSEvent for the
            // duration of the call.
            let event: &NSEvent = unsafe { event.as_ref() };
            on_flags(event, epoch, &app, &det);
        });
        // The block lives for the monitor's life because AppKit copies/retains
        // it. We intentionally leak the returned monitor token (the monitor lives
        // for the whole app run).
        let token: Option<Retained<AnyObject>> =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &handler);
        match token {
            Some(t) => {
                // Keep the monitor alive for the app's lifetime.
                std::mem::forget(t);
                log::info!("voice: installed global right-Command double-tap monitor");
            }
            None => log::warn!(
                "voice: global NSEvent monitor not installed (no Accessibility permission?); \
                 double-tap works only while focused — mic button still works"
            ),
        }
    }

    // LOCAL monitor: fires while the app IS focused; needs no special permission.
    // Its handler must RETURN the event (passing it through unmodified).
    {
        let app = app.clone();
        let det = detector.clone();
        let handler = block2::RcBlock::new(move |event: core::ptr::NonNull<NSEvent>| -> *mut NSEvent {
            // SAFETY: AppKit hands us a valid NSEvent for the call's duration.
            let ev_ref: &NSEvent = unsafe { event.as_ref() };
            on_flags(ev_ref, epoch, &app, &det);
            // Pass the event through unchanged.
            event.as_ptr()
        });
        // SAFETY: standard AppKit API; see the global-monitor note above.
        let token: Option<Retained<AnyObject>> =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
        match token {
            Some(t) => {
                std::mem::forget(t);
                log::info!("voice: installed local right-Command double-tap monitor");
            }
            None => log::warn!("voice: local NSEvent monitor not installed; mic button still works"),
        }
    }
}

/// No-op activation monitor on non-macOS platforms (the mic button is the entry
/// point everywhere; the native gesture is macOS-only).
#[cfg(not(target_os = "macos"))]
pub fn start(_app: tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::DoubleTapDetector;

    /// "Open via double-tap right Command": two taps inside the window complete
    /// the gesture.
    #[test]
    fn double_tap_within_window_triggers() {
        let mut d = DoubleTapDetector::new(400);
        assert!(!d.tap(1_000), "first tap alone never fires");
        assert!(d.tap(1_300), "second tap 300ms later completes the double-tap");
    }

    /// Two taps spaced beyond the window do NOT count as a double-tap; the second
    /// just re-arms.
    #[test]
    fn taps_outside_window_do_not_trigger() {
        let mut d = DoubleTapDetector::new(400);
        assert!(!d.tap(1_000));
        assert!(!d.tap(1_500), "500ms > 400ms window → not a double-tap");
    }

    /// A single tap never fires.
    #[test]
    fn first_tap_alone_does_not_trigger() {
        let mut d = DoubleTapDetector::new(400);
        assert!(!d.tap(42));
    }

    /// A triple-tap fires exactly once: the 2nd completes a pair, the 3rd starts
    /// a fresh pair (it must NOT immediately re-fire).
    #[test]
    fn triple_tap_does_not_double_fire() {
        let mut d = DoubleTapDetector::new(400);
        assert!(!d.tap(1_000), "tap 1: arm");
        assert!(d.tap(1_100), "tap 2: completes the double-tap");
        assert!(!d.tap(1_200), "tap 3: starts a fresh pair, must not re-fire");
        assert!(d.tap(1_300), "tap 4: completes the new pair");
    }

    /// The exact window boundary (gap == window_ms) still counts (`<=`).
    #[test]
    fn gap_equal_to_window_triggers() {
        let mut d = DoubleTapDetector::new(400);
        assert!(!d.tap(1_000));
        assert!(d.tap(1_400), "gap exactly == window must count");
    }

    /// An out-of-order clock (now < stored) does not underflow; it re-arms and a
    /// subsequent in-window tap still fires.
    #[test]
    fn out_of_order_clock_is_handled() {
        let mut d = DoubleTapDetector::new(400);
        assert!(!d.tap(1_000));
        assert!(!d.tap(500), "earlier-than-stored tap re-arms, never fires/underflows");
        assert!(d.tap(700), "then a normal in-window tap completes the pair");
    }
}
