// PURE collector for the ACTIVITY a bare shell reports about itself — the signal
// that titles a terminal row (`session-titles`: "Bare terminal rows are titled
// from the activity the shell reports").
//
// The source is the terminal's own OSC 0/2 window title, which the shell sets:
// on a configured shell that is the command being run, and otherwise the working
// directory. Deliberately NOT the user's keystrokes and NOT the rendered output:
//
//  - Keystrokes carry secrets that no gate can reliably separate from commands.
//    A hidden prompt is not always visible to us (a shell BUILTIN like `read`
//    never changes the foreground process group), a sourced script can prompt
//    with echo left ON, a heredoc body and a token piped to `gh auth login
//    --with-token` are typed exactly like commands. Every one of those reaches
//    the input stream; NONE of them reaches the window title, because a shell
//    sets the title when it DISPATCHES a command, never while a program reads
//    stdin.
//  - Rendered output changes on every chunk (a build, `tail -f`), so it can never
//    settle into a stable change key, and it carries whatever programs print.
//
// The joined activity list IS the change key: the caller compares it for
// equality, so no hashing is needed. It lives in memory only, never persisted.

/** The bounded activity a shell has reported, oldest first. */
export interface ActivityRing {
  entries: string[];
}

/** How many distinct reported titles to remember (bounds the model prompt). */
export const MAX_ACTIVITY = 12;
/** Longest single entry kept; a title longer than this is clipped. */
export const MAX_ENTRY = 120;

/** An empty ring. */
export function emptyActivity(): ActivityRing {
  return { entries: [] };
}

/**
 * Add a reported title. Blank titles are ignored, a repeat of the most recent
 * entry is collapsed (a shell re-sets the same title on every prompt), and the
 * oldest entry drops past `MAX_ACTIVITY`. Pure: never mutates `ring`.
 */
export function noteActivity(ring: ActivityRing, title: string): ActivityRing {
  const t = title.trim().slice(0, MAX_ENTRY);
  if (!t) return ring;
  if (ring.entries[ring.entries.length - 1] === t) return ring;
  const entries = [...ring.entries, t];
  return { entries: entries.length > MAX_ACTIVITY ? entries.slice(entries.length - MAX_ACTIVITY) : entries };
}

/**
 * The change key + model input: the reported titles joined by newlines, or null
 * when the shell has reported nothing beyond a single unchanging title — one
 * entry is just "where the shell sits", which says nothing about what the user
 * was doing, so such a terminal is left untitled rather than titled from noise.
 */
export function activityText(ring: ActivityRing): string | null {
  return ring.entries.length > 1 ? ring.entries.join('\n') : null;
}
