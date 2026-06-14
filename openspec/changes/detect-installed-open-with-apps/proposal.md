## Why

The "Open files with" section of the Settings dialog lists a fixed, curated set of
applications (Cursor, VS Code, Zed, Chrome, Safari, …) regardless of what is
actually installed. A user is offered — and can silently select — an app they do
not have, in which case the open later fails with no feedback. The list is also
plain text, so it takes a beat to recognize each app. Showing only installed apps,
each with its own icon, makes the choice trustworthy and scannable.

## What Changes

- The "Open files with" category dropdowns SHALL list **only applications detected
  as installed** on the system (strict filter). "System Default" and "Custom…"
  always remain; a category's currently-saved app is always kept in its list even
  if no longer detected, so a user never silently loses a setting.
- A new Tauri/Rust command detects which of the curated candidate apps are
  installed by probing the standard macOS application directories for each
  `<name>.app` (special-casing Finder under CoreServices).
- Each application choice (and "System Default" / "Custom…") SHALL show a small
  **icon**: a vendored, filled, monochrome single-path brand glyph per known app,
  with category fallbacks (editor / browser / Finder) and a generic fallback for
  custom or unrecognized names.
- The native `<select>` controls in the Settings dialog SHALL be replaced by a
  single reusable, keyboard-navigable custom **Dropdown** component. It is used by
  **every** settings dropdown (Density, Transcription quality, the two Notification
  selects, and the four Open-files rows); per-option icons are supplied only where
  relevant (the Open-files rows).
- Detection is macOS-only. In a non-macOS / non-Tauri / dev context, detection
  returns nothing and the curated apps are simply absent (only "System Default" +
  "Custom…" + any saved app show) — no fabricated list.

## Capabilities

### New Capabilities
- `settings-dropdown`: a single reusable, accessible custom dropdown control used by
  every dropdown in the Settings dialog (keyboard navigation, Escape / outside-click
  dismissal, optional per-option icon), replacing the native `<select>` elements.

### Modified Capabilities
- `open-with-preferences`: the Settings-dialog editing requirement changes so each
  category lists only **installed** applications and shows a per-app **icon**; two
  new requirements cover installed-app detection and the per-app icon.

## Impact

- **Frontend (Svelte/TS)**: `src/lib/settings/openWith.svelte.ts` (choice-filtering
  + app→icon helpers, installed-apps store), a new `Dropdown.svelte`, a new brand
  icon set (`brandIcons.ts` + filled-icon rendering), and `SettingsModal.svelte`
  (migrate all selects to `Dropdown`).
- **Backend (Rust/Tauri)**: new `installed_apps` command in `src-tauri/src/lib.rs`,
  registered in `generate_handler!`, with a pure path-builder/filter helper.
- **Tests**: Rust unit tests for the detection path-builder/filter (temp dirs); TS
  pure-logic tests for choice-filtering and app→icon mapping.
- No persistence-format change; saved preferences and existing open behavior are
  preserved.
