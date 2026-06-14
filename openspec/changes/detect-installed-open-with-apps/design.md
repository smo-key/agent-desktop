## Context

`open-with-preferences` already classifies a target into one of four buckets
(code / html / markdown / other) and lets the user pick an app per bucket in the
Settings dialog (`SettingsModal.svelte`), persisted via the `openWith` store
(`src/lib/settings/openWith.svelte.ts`). The bucket choices come from a hardcoded
`APP_CHOICES` map and render in native `<select>` elements. Nothing checks whether
a chosen app exists, and there are no icons.

This is a macOS-only Tauri app: the backend already shells out to `open` /
`open -a <App>` in `src-tauri/src/lib.rs`, with pure helpers (`open_args`,
`path_within`) unit-tested against temp dirs. The frontend tests are pure-logic
only (Vitest); `invoke` is mocked at the module top. Icons today come from a
vendored, **stroke-only** Lucide-style set (`Icon.svelte` hardcodes `fill:none`).

## Goals / Non-Goals

**Goals:**

- Show only installed apps in each "Open files with" category (strict filter), while
  always keeping "System Default", "Custom…", and the category's currently-saved app.
- Show a recognizable icon next to every application choice.
- Replace the native `<select>`s with one reusable, keyboard-accessible custom
  dropdown used by **all** Settings dropdowns; icons supplied only where relevant.
- Keep detection, filtering, and icon-mapping logic pure and unit-tested.

**Non-Goals:**

- Cross-platform detection (Windows/Linux). macOS only; elsewhere detection is empty.
- Real, full-color app-icon extraction from `.app` bundles (chosen against; we vendor
  monochrome brand glyphs instead).
- Changing classification, the open/launch behavior, or the persisted settings format.
- Live re-detection while the modal is open (detect once per modal open is enough).

## Decisions

### Detection: filesystem probe of standard app directories (Rust)

A new command `installed_apps(names: Vec<String>) -> Vec<String>` returns the subset
of `names` whose `<name>.app` exists in any standard macOS application directory:
`/Applications`, `~/Applications`, `/System/Applications`,
`/System/Applications/Utilities`, `/System/Library/CoreServices` (the last covers
Finder). The candidate-path builder is a pure function
`app_bundle_paths(name, home, roots) -> Vec<PathBuf>`; existence-checking is a thin
shell over it so the path logic is unit-tested against temp dirs (mirroring
`path_within`). Registered in `generate_handler!` next to `open_path`.

- **Why not `mdfind`/Spotlight?** Spotlight can be disabled or unindexed; a direct
  path probe is deterministic and dependency-free.
- **Why not `open -Ra`?** No reliable non-launching "does this app resolve" flag; the
  display-name → bundle resolution is exactly what the `<name>.app` probe approximates,
  and every curated app's bundle name equals its `open -a` display name.

### Filtering: pure helper, strict, order-preserving, keep-selected

`visibleChoices(all: string[], installed: Set<string>, current: string): string[]`
returns `all` filtered to installed apps, preserving `all`'s order, and always
including `current` if it is a real app name (not `SYSTEM`/blank) even when not
installed — so a saved preference is never silently dropped from its own list.
"System Default" and "Custom…" are added by the UI, not by this helper. With an
empty `installed` set (non-macOS/dev), the result is just `current` (if any).

The installed set is fetched once when the modal opens via a small reactive store
that calls `invoke('installed_apps', { names })` over the union of all
`APP_CHOICES`; failure/non-Tauri → empty set (strict).

### Icons: vendored filled monochrome brand glyphs + fallbacks

Brand marks are silhouettes, so a new `brandIcons.ts` holds **filled**
(`fill:currentColor`, no stroke) single-path glyphs, rendered by extending
`Icon.svelte` with a `filled` mode (when set, the `<svg>` uses `fill` from the glyph
and `stroke:none`). A pure `appIcon(name): string` maps a known app → its brand glyph,
falling back by category (editors → a code glyph, browsers → globe, Finder → folder,
TextEdit → a document glyph) and finally to a generic app glyph for custom/unknown
names; `SYSTEM` → a gear/monitor glyph, "Custom…" → plus.

- Apple system apps (Finder, TextEdit) and any app without a public mark use category
  glyphs by design — this is the one inherently approximate part and is documented.

### Reusable dropdown: `Dropdown.svelte` (trigger + popover listbox)

A controlled component: props `value`, `options: {value; label; icon?}[]`,
`onChange(value)`, optional `width` and `ariaLabel`. It renders a trigger button
(showing the active option's icon+label) and, when open, a popover `role="listbox"`
of `role="option"` rows, styled to match `ContextMenu`/`FooterPopover` (fixed-position
panel, full-screen scrim, close on Escape / outside-click / select). Keyboard: Up/Down
roving highlight, Home/End, Enter/Space select, Escape close; the active row shows a
checkmark. The roving-index math is extracted to a pure helper and unit-tested.

`SettingsModal.svelte` migrates every native `<select>` to `Dropdown`. The four
Open-files rows build their option list as `[System Default] + visibleChoices(...) +
[Custom…]`, each option carrying `appIcon(...)`; "Custom…" still reveals the existing
free-text field. The other dropdowns (Density, Transcription quality, the two
Notification selects) pass options with no `icon`.

## Risks / Trade-offs

- **An app installed in a non-standard location is treated as absent.** → It still
  works via "Custom…", and any already-saved selection is retained; the common case
  (`/Applications`, system dirs) is covered.
- **Brand glyphs are approximate / monochrome.** → Accept by design (user chose brand
  SVGs over real icons); recognizability is preserved with simple distinctive marks and
  category fallbacks.
- **Replacing native `<select>` loses built-in a11y/typeahead.** → Mitigated by full
  keyboard support and ARIA listbox semantics, matching existing popover patterns;
  applies uniformly to all settings dropdowns so behavior stays consistent.
- **Detection adds an IPC round-trip on modal open.** → One call, cheap stat()s,
  fetched once and cached for the modal's lifetime; UI renders immediately and the
  lists populate when it resolves.
