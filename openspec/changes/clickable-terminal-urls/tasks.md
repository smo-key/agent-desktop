# Tasks — clickable-terminal-urls

## 1. URL detection (TS — `src/lib/terminalLinks.ts`)
- [x] 1.1 Add a `stripLineCol` option to `normalizeToken` (default `true`, preserving current behavior) so callers can opt out of `:line[:col]` stripping
- [x] 1.2 Add a pure `urlAt(line, col)` helper: extract the run, strip decorations WITHOUT `:line` stripping, and return the cleaned token only when it is an `http(s)` URL (else null)
- [x] 1.3 Tests: `urlAt` detects http/https, keeps `:port`, strips wrapping/punctuation, rejects scheme-less tokens and whitespace, reports the correct line-coordinate range; `normalizeToken` honors `stripLineCol: false`

## 2. URL classification (TS — `src/lib/settings/openWith.svelte.ts`)
- [x] 2.1 `classify()` routes `http(s)` URLs to the `html` bucket by scheme (before extension checks)
- [x] 2.2 Tests: `classify` maps URLs (incl. one with a `.css` path) to `html`; `resolveApp` returns the html app for a URL

## 3. Wire the affordance (Svelte — `src/lib/TerminalPane.svelte`)
- [x] 3.1 In `updateHover`, check `urlAt` first; when it matches, arm the URL directly (bump `resolveSeq`, set `armedPath`/`armedKey`, underline) with no `resolve_path` round-trip; otherwise fall back to the existing file-link path
- [x] 3.2 Confirm ⌘-click opens the armed URL via `openWith.openFile` (no handler change expected)

## 4. Settings label (Svelte — `src/lib/ui/SettingsModal.svelte`)
- [x] 4.1 Relabel the HTML row to "HTML files and URLs"

## 5. Close-out
- [x] 5.1 `openspec validate clickable-terminal-urls`, `npm run check`, `npm test` pass
- [ ] 5.2 Adversarial code review, verify, sync spec deltas into `openspec/specs/`, archive
