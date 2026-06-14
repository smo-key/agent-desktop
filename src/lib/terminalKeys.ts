// Translate a host (browser) keyboard chord into the raw bytes a terminal
// program expects, for chords xterm itself does not forward to the PTY.
//
// macOS convention: ⌘← jumps to the beginning of the current line and ⌘→ to the
// end. xterm captures keys via a hidden <textarea> and emits nothing for
// ⌘-modified arrows, so a terminal pane ignores them today (native inputs get
// this from WKWebView for free). We map them to the universal readline/emacs
// line-edge bindings Ctrl-A (\x01) / Ctrl-E (\x05) — which bash, zsh, fish, and
// Claude Code's TUI all honor — and feed those bytes to the PTY ourselves.

/** The minimal shape of a `KeyboardEvent` this helper reads. */
export interface KeyChord {
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

/**
 * The PTY byte sequence for a bare ⌘← / ⌘→ line-edge chord, or `null` when the
 * chord is anything else (so the caller leaves the keystroke for xterm to
 * handle). Requires ⌘ and excludes ⌥/⌃ so ⌥← (word-wise) and ⌃← fall through
 * untouched. Shift is intentionally not consulted — a terminal has no
 * selection-extend semantics, so ⌘⇧← behaves the same as ⌘←.
 */
export function lineEditSeq(e: KeyChord): '\x01' | '\x05' | null {
  if (!e.metaKey || e.altKey || e.ctrlKey) return null;
  if (e.key === 'ArrowLeft') return '\x01'; // Ctrl-A — beginning of line
  if (e.key === 'ArrowRight') return '\x05'; // Ctrl-E — end of line
  return null;
}
