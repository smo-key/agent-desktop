# Make HTTP/HTTPS URLs clickable in the terminal

## Why

The terminal already linkifies existing filesystem paths on ⌘-hover and opens
them on ⌘-click via the user's open-with preferences. But a huge fraction of the
links Claude (and ordinary tooling) prints in the terminal are HTTP/HTTPS URLs —
PR links, docs, dashboards, `localhost` dev servers. Today those are dead text:
they never resolve to a filesystem path, so they get no affordance and can't be
opened. The user has to select-copy-paste the URL into a browser. URLs should be
first-class clickable links, opened the same way every other link type is.

## What Changes

- **URLs are linkified like file paths.** While ⌘ is held, a token under the
  pointer that is an `http://` or `https://` URL gets the same dotted-underline +
  pointer affordance as an existing file path. Unlike file tokens, a URL is NOT
  validated against the filesystem — being a well-formed `http(s)` URL is enough.
- **A trailing `:port` is preserved.** URL detection reuses the existing
  decoration stripping (surrounding quotes/brackets, trailing sentence
  punctuation) but does NOT strip a trailing `:line` suffix, since for a URL that
  would corrupt `host:port` (e.g. `http://localhost:3000`).
- **⌘-click opens the URL via the HTML open-with preference.** URLs are
  classified into the existing **HTML** category, so they open in the user's
  configured HTML/browser app (or the OS default). The same ⌘-click handler,
  open path, and "not delivered to the terminal process" / "launch failure is
  non-fatal" guarantees apply.
- **The Settings label becomes "HTML files and URLs."** Because the HTML category
  now governs both `.html`/`.htm`/`.xhtml` files and `http(s)` URLs, its Settings
  row is relabeled to make that scope clear. Behavior of the dropdown is
  otherwise unchanged.

Bare hostnames or filenames without a scheme (e.g. `example.com`, `foo.io`) are
NOT linkified as URLs — only `http://`/`https://` tokens are — to avoid false
positives on ordinary filenames.

## Impact

- Affected specs:
  - `terminal-file-links` → new requirement for the URL link affordance + open.
  - `open-with-preferences` → HTML category also covers `http(s)` URLs; Settings
    label is "HTML files and URLs".
- Code:
  - `src/lib/terminalLinks.ts` — new `urlAt` helper + `normalizeToken`
    `stripLineCol` option (+ tests).
  - `src/lib/settings/openWith.svelte.ts` — `classify` routes `http(s)` URLs to
    `html` (+ tests).
  - `src/lib/TerminalPane.svelte` — `updateHover` arms a URL token directly (no
    `resolve_path` round-trip); ⌘-click already opens `armedPath`.
  - `src/lib/ui/SettingsModal.svelte` — HTML row label → "HTML files and URLs".
- No Rust changes: `open_path` already passes any string to macOS `open`, which
  natively opens `http(s)` URLs (with or without `-a <app>`); URLs bypass
  `resolve_path` entirely.
