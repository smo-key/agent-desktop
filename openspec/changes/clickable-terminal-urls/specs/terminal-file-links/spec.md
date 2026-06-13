# terminal-file-links delta

## ADDED Requirements

### Requirement: HTTP/HTTPS URL link affordance and open

The terminal SHALL treat a token that is an `http://` or `https://` URL as an
actionable link, using the SAME ⌘-gated affordance as file links: while ⌘ is
held and the pointer is over a URL token, the terminal SHALL render that token
with a dotted underline and a pointer cursor, and a ⌘-click SHALL open it.
Unlike a file token, a URL SHALL NOT be validated against the filesystem — being
a well-formed `http(s)` URL is sufficient to linkify it (no `resolve_path`
round-trip). Only tokens with an explicit `http://` or `https://` scheme SHALL be
linkified as URLs; a bare hostname or filename without a scheme (e.g.
`example.com`) SHALL NOT.

When decorating a URL candidate, the terminal SHALL strip the same wrapping
decorations as for file tokens — one layer of surrounding quotes/backticks, one
layer of wrapping brackets (`()`, `[]`, `<>`), and trailing sentence punctuation —
but SHALL NOT strip a trailing `:line` / `:line:col` suffix, because for a URL
that would corrupt a `host:port` (e.g. `http://localhost:3000`). The underline
range SHALL cover only the cleaned URL.

A ⌘-clicked URL SHALL open according to the user's open-with preference for the
HTML category (see the `open-with-preferences` capability): the configured
HTML/browser application, or the OS default handler when that category is
"System Default". As with file links, the ⌘-click SHALL NOT be delivered to the
terminal process (no selection, no mouse-report escape sequence), and a failure
to launch SHALL NOT block or crash the UI.

#### Scenario: URL is linkified on ⌘-hover without filesystem resolution

- **WHEN** the user holds ⌘ and moves the pointer over a token `https://example.com/docs`
- **THEN** the token is rendered with a dotted underline and a pointer cursor, without resolving it against the filesystem

#### Scenario: A host:port URL keeps its port

- **WHEN** the user ⌘-hovers `http://localhost:3000` (a URL with no path after the port)
- **THEN** the linkified URL is `http://localhost:3000` (the `:3000` is treated as a port, not stripped as a `:line` suffix)

#### Scenario: Surrounding decorations are stripped from a URL

- **WHEN** the user ⌘-hovers a URL printed as `(https://example.com).`
- **THEN** the linkified URL is `https://example.com` and the underline covers only `https://example.com`, not the parentheses or trailing period

#### Scenario: A scheme-less token is not linkified as a URL

- **WHEN** the user ⌘-hovers a token `example.com` or `foo.io` that has no `http://`/`https://` scheme
- **THEN** it is not linkified as a URL (it is treated like any other token — linkified only if it resolves to an existing path)

#### Scenario: ⌘-click opens a URL via the HTML/URL preference

- **WHEN** the user ⌘-clicks a linkified `http(s)` URL and the HTML category is configured to a specific browser
- **THEN** the URL is opened in that browser (or the OS default handler when the HTML category is "System Default"), and no text selection begins and no mouse event is reported to the running program

#### Scenario: URL launch failure is non-fatal

- **WHEN** opening a ⌘-clicked URL fails
- **THEN** the error is handled silently (logged/ignored) and the terminal remains responsive
