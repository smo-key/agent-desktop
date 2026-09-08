// PURE collector for the ACTIVITY a terminal reports about itself — the signal
// that titles a terminal row (`session-titles`: "Bare terminal rows are titled
// from the activity the terminal reports").
//
// The source is the terminal's window title (the OSC 0/2 sequences a shell emits,
// plus a title-stack pop). On a configured shell that is the command it just
// dispatched; otherwise it is the working directory. Deliberately NOT the user's
// keystrokes and NOT the rendered output:
//
//  - Keystrokes carry what PROGRAMS READ FROM STDIN, and no gate we control can
//    reliably separate that from commands: a hidden prompt is not always visible
//    to us (a shell BUILTIN like `read` never changes the foreground process
//    group), a sourced script can prompt with echo left ON, and a heredoc body or
//    a token piped to a CLI is typed exactly like a command. None of that reaches
//    the window title, because a title is set when a command is DISPATCHED, not
//    while a program reads input.
//  - Rendered output changes on every chunk (a build, `tail -f`), so it never
//    settles into a stable change key, and it carries everything programs print.
//
// What this source DOES carry, stated plainly rather than assumed away:
//  - a secret passed as an ARGUMENT (`mysql -pS3cret`, `export TOKEN=…`) is part
//    of the dispatched command line, so a shell that titles from the command line
//    puts it in the title. `redactSecrets` strips the obvious shapes before an
//    entry is stored, but it is a COURTESY layer with known gaps (see its doc),
//    not a boundary: what makes this acceptable is that terminal titles are
//    generated ON-DEVICE ONLY and the ring is never persisted.
//  - the title is set by BYTES ON THE OUTPUT STREAM, so a remote host over `ssh`,
//    or a file dumped to the terminal, can write it. Entries are therefore
//    untrusted text: they are clipped, stripped of controls, and framed as DATA
//    in the model prompt — the same footing as any other terminal content the app
//    already shows (the row sub-line renders the raw title today).
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
 * Add a reported title. Blank titles are ignored and a title ALREADY in the ring
 * is dropped, not re-appended: a configured shell sets the title twice per
 * command (the directory at the prompt, the command on dispatch), so an
 * append-only ring would alternate `dir, cmd, dir, cmd…` — the change key would
 * move on every command and spend a model call each time, and the ring would
 * fill with repeats of one directory. Set semantics keep the key stable until
 * something genuinely NEW happens. The oldest entry drops past `MAX_ACTIVITY`.
 * Pure: never mutates `ring`.
 */
export function noteActivity(ring: ActivityRing, title: string): ActivityRing {
  // Strip C0/C1 controls first (the title arrives as arbitrary output bytes) and
  // collapse the resulting whitespace, so one entry is always a single line.
  const clean = title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ');
  const t = redactSecrets(clean).trim().slice(0, MAX_ENTRY);
  if (!t || ring.entries.includes(t)) return ring;
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

/**
 * Replace the obvious SECRET shapes in a reported title with `…`, before it is
 * stored or shown to the model: an assignment to a key/token/password/secret
 * variable, a `-p`/`--password=`/`--token=` argument, credentials embedded in a
 * URL, and the well-known provider token prefixes. Best-effort by nature — a
 * secret can be an arbitrary string in an arbitrary flag — which is exactly why
 * the on-device-only rule and the memory-only ring carry the real weight. Pure.
 */
export function redactSecrets(title: string): string {
  return title
    // https://user:pass@host
    .replace(/(:\/\/[^\s:/@]+):[^\s@/]+@/g, '$1:…@')
    // KEY=value, with or without a prefix (`TOKEN=…` as well as `GITHUB_TOKEN=…`).
    .replace(
      /(\b(?:[A-Za-z_][\w-]*)?(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b\s*=\s*)\S+/gi,
      '$1…'
    )
    // `PWD`/`PASSWD` anywhere EXCEPT as the bare shell variables `PWD`/`OLDPWD`,
    // whose value is a working directory a shell reports, not a secret. So
    // `db-pwd=`, `MYSQLPWD=` and `DB_PASSWD=` redact while `PWD=/home/me` and
    // `OLDPWD=/tmp` stay readable.
    .replace(/(\b[A-Za-z_][\w-]*(?:PWD|PASSWD)\b\s*=\s*)\S+/gi, (m, head: string) =>
      /^(?:OLD)?PWD\s*=/i.test(head) ? m : `${head}…`
    )
    .replace(/(--(?:password|token|secret|api-key|apikey)[= ])\S+/gi, '$1…')
    // `-pSecret` — the mysql/mariadb form, where the value is ATTACHED to the
    // flag. Only that shape: a space-separated `-p` is far more often a port or a
    // pid (`docker run -p 8080:80`, `ps -p 123`, `git log -p`), and mangling those
    // both loses real signal and can collide two distinct titles into one.
    // A value that looks like a port, path, host:port — or a plain lowercase word,
    // which is how the common alpha flags read (`find -print`, `tar -pxvf`, `gcc
    // -pipe`) — is left alone. Redacting those would both lose signal and collide
    // two distinct titles into one, which stalls the change key.
    //
    // KNOWN GAP, stated rather than papered over: an all-lowercase attached
    // password (`-psecret`) is kept for exactly that reason — it is the same shape
    // and length as `-prune`, `-passin`, `-pretty`, and no regex separates them.
    // Redaction is a courtesy layer; the guarantees that matter are that terminal
    // titles are generated ON-DEVICE ONLY and the ring is never persisted.
    .replace(/(\s-p)(?![\s\d])(?!\S*[:/])(?![a-z]+\b)(\S+)/g, '$1…')
    // Bare provider tokens wherever they appear
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{8,}|xox[abprs]-[A-Za-z0-9-]{8,})/g, '…');
}
