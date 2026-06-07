//! Native macOS right-Command tap activation for the voice panel.
//!
//! Two layers live here:
//!
//!   * [`SoloTapDetector`] — a PURE, headless-testable state machine. The native
//!     monitor feeds it edge events (right-Command pressed / released, and "some
//!     other key was used"); it decides whether a release completed a *solo tap*
//!     — right-Command pressed and released with no other key in between. It holds
//!     no time source or OS state, so its full behaviour is unit-tested.
//!
//!   * [`start`] — the native `NSEvent` monitor (macOS only). It installs both a
//!     GLOBAL and a LOCAL monitor over `flagsChanged | keyDown`, isolates the
//!     RIGHT-Command key (keyCode 54), drives the detector, and on a completed
//!     solo tap emits the `voice://activate` Tauri event the frontend listens for.
//!
//! ## Why a *solo* tap (not just "any right-Command press")
//!
//! Right-Command is also a normal shortcut modifier (e.g. right-⌘+C). Firing on
//! every press would hijack those chords. So we only activate when right-Command
//! is tapped ALONE: pressed, then released, with no other key or modifier used
//! during the hold. A right-⌘+C disarms (the `C` keyDown marks "other key"), so
//! it never triggers voice.
//!
//! ## macOS permission caveat (IMPORTANT)
//!
//! A **GLOBAL** `NSEvent` monitor for key/flag events only fires while the app
//! holds **Accessibility / Input-Monitoring** permission (System Settings →
//! Privacy & Security). Without it the global monitor installs successfully but
//! silently never fires, so the gesture won't work while the app is in the
//! background. The **LOCAL** monitor needs no such permission and still fires
//! while the app is focused. The on-screen footer mic button is the always-works
//! fallback and is wholly independent of this monitor.
//!
//! `start` is best-effort: any failure is logged and swallowed so the app — and
//! the mic button — keep working. On non-macOS it is a no-op.

/// Pure solo-tap state machine. The native monitor reports edges; the detector
/// decides whether a release completed a clean solo tap of right-Command.
#[derive(Default)]
pub struct SoloTapDetector {
    /// Right-Command is currently held after a clean press.
    armed: bool,
    /// Another key/modifier fired during the current hold (disarms the tap).
    other_seen: bool,
}

impl SoloTapDetector {
    /// A fresh detector (nothing held).
    pub fn new() -> Self {
        Self::default()
    }

    /// Right-Command went down. Begins a potential solo tap. `other_modifiers` is
    /// true when another modifier (Shift/Control/Option) was already held at the
    /// moment of the press — that makes it a chord, not a solo tap.
    pub fn press(&mut self, other_modifiers: bool) {
        self.armed = true;
        self.other_seen = other_modifiers;
    }

    /// Any other key or modifier activity observed while (potentially) holding
    /// right-Command. Disarms so a chord (right-⌘ + X) is not a solo tap. A no-op
    /// when right-Command isn't held.
    pub fn other_key(&mut self) {
        if self.armed {
            self.other_seen = true;
        }
    }

    /// Right-Command went up. Returns `true` iff this completed a clean solo tap
    /// (armed by a press with no other key in between). Always resets state.
    pub fn release(&mut self) -> bool {
        let fired = self.armed && !self.other_seen;
        self.armed = false;
        self.other_seen = false;
        fired
    }
}

/// Install the native right-Command tap monitor (macOS only). Best-effort: any
/// failure is logged and swallowed. No-op on other platforms.
#[cfg(target_os = "macos")]
pub fn start(app: tauri::AppHandle) {
    use std::sync::{Arc, Mutex};

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
    use tauri::Emitter;

    /// keyCode 54 = RIGHT Command (55 = left, ignored).
    const RIGHT_COMMAND_KEYCODE: u16 = 54;

    // Shared detector so the gesture works regardless of which monitor (global vs
    // local) sees the edges.
    let detector = Arc::new(Mutex::new(SoloTapDetector::new()));

    // True when a modifier OTHER than Command is present in `flags`.
    fn has_other_modifier(flags: NSEventModifierFlags) -> bool {
        flags.contains(NSEventModifierFlags::Shift)
            || flags.contains(NSEventModifierFlags::Control)
            || flags.contains(NSEventModifierFlags::Option)
    }

    // Shared handler body: drive the detector from NSEvent edges and emit the
    // activation event when a solo right-Command tap completes.
    let on_event = move |event: &NSEvent,
                         app: &tauri::AppHandle,
                         det: &Arc<Mutex<SoloTapDetector>>| {
        let mut d = match det.lock() {
            Ok(d) => d,
            Err(_) => return,
        };
        match event.r#type() {
            // Any non-modifier key press during a hold disarms the solo tap.
            NSEventType::KeyDown => d.other_key(),
            NSEventType::FlagsChanged => {
                let flags = event.modifierFlags();
                if event.keyCode() == RIGHT_COMMAND_KEYCODE {
                    if flags.contains(NSEventModifierFlags::Command) {
                        // Press edge (Command flag now set).
                        d.press(has_other_modifier(flags));
                    } else {
                        // Release edge (Command flag cleared).
                        if d.release() {
                            app.emit("voice://activate", ()).ok();
                        }
                    }
                } else {
                    // Some other modifier changed during the hold → chord, disarm.
                    d.other_key();
                }
            }
            _ => {}
        }
    };

    // Monitor both modifier changes and key presses so chords disarm the tap.
    let mask = NSEventMask::FlagsChanged | NSEventMask::KeyDown;

    // GLOBAL monitor: fires while the app is NOT focused (needs Accessibility /
    // Input-Monitoring permission — see module docs). Handler returns void.
    {
        let app = app.clone();
        let det = detector.clone();
        let on_event = on_event.clone();
        let handler = block2::RcBlock::new(move |event: core::ptr::NonNull<NSEvent>| {
            // SAFETY: AppKit hands us a valid, autoreleased NSEvent for the
            // duration of the call.
            let event: &NSEvent = unsafe { event.as_ref() };
            on_event(event, &app, &det);
        });
        let token: Option<Retained<AnyObject>> =
            NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &handler);
        match token {
            Some(t) => {
                // Keep the monitor alive for the app's lifetime.
                std::mem::forget(t);
                log::info!("voice: installed global right-Command tap monitor");
            }
            None => log::warn!(
                "voice: global NSEvent monitor not installed (no Accessibility permission?); \
                 the tap works only while focused — mic button still works"
            ),
        }
    }

    // LOCAL monitor: fires while the app IS focused; needs no special permission.
    // Its handler must RETURN the event (passing it through unmodified).
    {
        let app = app.clone();
        let det = detector.clone();
        let handler =
            block2::RcBlock::new(move |event: core::ptr::NonNull<NSEvent>| -> *mut NSEvent {
                // SAFETY: AppKit hands us a valid NSEvent for the call's duration.
                let ev_ref: &NSEvent = unsafe { event.as_ref() };
                on_event(ev_ref, &app, &det);
                // Pass the event through unchanged.
                event.as_ptr()
            });
        // SAFETY: standard AppKit API; see the global-monitor note above.
        let token: Option<Retained<AnyObject>> =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
        match token {
            Some(t) => {
                std::mem::forget(t);
                log::info!("voice: installed local right-Command tap monitor");
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
    use super::SoloTapDetector;

    /// "Open via right Command tap": a clean press → release with nothing in
    /// between fires.
    #[test]
    fn solo_tap_triggers() {
        let mut d = SoloTapDetector::new();
        d.press(false);
        assert!(d.release(), "press then release with no other key is a solo tap");
    }

    /// A release with no prior press never fires.
    #[test]
    fn release_without_press_does_not_trigger() {
        let mut d = SoloTapDetector::new();
        assert!(!d.release());
    }

    /// A chord (right-⌘ + another key) does NOT count: the keyDown disarms it.
    #[test]
    fn chord_with_other_key_does_not_trigger() {
        let mut d = SoloTapDetector::new();
        d.press(false);
        d.other_key(); // e.g. "C" pressed while holding right-⌘
        assert!(!d.release(), "right-⌘+key is a shortcut, not a voice tap");
    }

    /// Holding another modifier at the moment of the press also disqualifies it.
    #[test]
    fn press_with_other_modifier_held_does_not_trigger() {
        let mut d = SoloTapDetector::new();
        d.press(true); // Shift/Control/Option already down
        assert!(!d.release());
    }

    /// `other_key` before any press is a no-op; the next clean tap still fires.
    #[test]
    fn other_key_before_press_is_noop() {
        let mut d = SoloTapDetector::new();
        d.other_key();
        d.press(false);
        assert!(d.release());
    }

    /// State resets after a release: a disarmed hold doesn't poison the next tap.
    #[test]
    fn state_resets_after_release() {
        let mut d = SoloTapDetector::new();
        d.press(false);
        d.other_key();
        assert!(!d.release(), "chord does not fire");
        d.press(false);
        assert!(d.release(), "the next clean tap fires");
    }
}
