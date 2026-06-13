## Why

Remembered window-layout choices "forget" on restart. The project pane's
collapsed/expanded state — and other layout preferences — are stored in
`localStorage`, but WKWebView (the Tauri webview on macOS) buffers `localStorage`
in memory and only flushes it lazily. An abrupt exit (`Ctrl-C` on `tauri dev`, a
hot-reload, a crash, a force-quit) drops the un-flushed writes, so the layout
resets on the next launch. The Rust-backed `settings.json` tier does not have
this problem: it is written atomically (temp file + rename) the moment a value
changes, which is exactly why durable state (projects, layout, settings) already
lives there.

## What Changes

- The five genuine UI-layout **preferences** move from `localStorage` to a new
  durable `ui` slice of `settings.json`: project-pane collapse, terminals-panel
  width, tasks-launcher split fraction, selected project filter, and the manual
  order of the draggable lanes (attn + paused).
- A new `uiPrefs` store owns that slice (sole writer), seeded with defaults and
  hydrated once on app mount — mirroring the existing `voice`/`open-with` stores.
  The `projectFilter` and terminals-panel stores become thin façades over it; the
  inbox reads its collapse / split / lane-order from it.
- **No data migration**: existing `localStorage` values are not read; each user's
  affected preferences reset to defaults once, then persist durably thereafter.
- The three remaining `localStorage` users — the session **title**, **summary**,
  and **cost** caches — stay as-is: they are regenerable (a miss recomputes from
  the transcript), so the lazy flush is harmless.
- A build gate (`tools/check-localstorage.mjs`, wired into the pre-commit hook and
  `check:gate`) fails if any file outside the regenerable-cache allowlist uses
  `localStorage`, so a future non-cache store can't quietly reintroduce the bug.

## Capabilities

### New Capabilities
- `ui-preferences`: Remembered UI-layout preferences persist in the durable
  `settings.json` `ui` slice (surviving an abrupt restart), not `localStorage`,
  which is reserved for regenerable session caches and enforced by a build gate.
