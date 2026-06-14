## 1. Backend: installed-app detection (Rust, TDD)

- [ ] 1.1 In `src-tauri/src/lib.rs`, add a pure `app_bundle_paths(name, home, roots) -> Vec<PathBuf>` that builds candidate `<name>.app` paths under each root, and a thin `installed_apps(names: Vec<String>) -> Vec<String>` Tauri command that returns the subset whose bundle exists, probing the standard roots (`/Applications`, `~/Applications`, `/System/Applications`, `/System/Applications/Utilities`, `/System/Library/CoreServices`).
- [ ] 1.2 Write Rust unit tests (temp dirs, mirroring `path_within`): `an_app_in_a_standard_directory_is_detected`, `an_absent_app_is_not_detected`, `finder_is_detected_under_core_services` (candidate paths include CoreServices). Run `cargo test` (in `src-tauri/`) green.
- [ ] 1.3 Register `installed_apps` in the `generate_handler!` list next to `open_path`.

## 2. Brand icons + filled-glyph rendering

- [ ] 2.1 Add a `filled` mode to `src/lib/icons/Icon.svelte` (or a sibling `BrandIcon.svelte`): when set, the `<svg>` uses `fill={color}` and `stroke: none` so filled single-path brand glyphs render correctly (today's `Icon.svelte` is stroke-only).
- [ ] 2.2 Create `src/lib/icons/brandIcons.ts` with vendored filled monochrome single-path glyphs for the curated apps (Cursor, Visual Studio Code, Zed, Sublime Text, Chrome, Safari, Firefox, Brave, Arc, Microsoft Edge) plus category/utility glyphs (generic app, editor, browser, document, system-default, custom). Keep marks simple and recognizable; document the source/approximation.

## 3. Frontend pure logic: filtering + icon mapping (TDD)

- [ ] 3.1 In `src/lib/settings/openWith.svelte.ts`, add pure `visibleChoices(all, installed, current)` (strict filter; preserve curated order; always keep a non-`SYSTEM` `current`; empty `installed` → only `current` if any).
- [ ] 3.2 Add pure `appIcon(name)` mapping: known app → brand glyph; category fallback (editor/browser/Finder→folder, TextEdit→document); unknown/custom → generic app glyph; `SYSTEM` → system glyph; custom-sentinel → custom glyph.
- [ ] 3.3 Extend `src/lib/settings/openWith.test.ts` (TDD): `installed_application_is_offered`, `uninstalled_application_is_hidden`, `the_saved_application_is_kept_even_when_not_installed`, `choices_preserve_their_curated_order`, `no_detection_yields_only_the_always_present_entries`; and for icons: `a_known_application_shows_its_brand_icon`, `an_unknown_or_custom_application_shows_a_generic_icon`, `apps_without_a_brand_mark_fall_back_by_category`, `system_default_and_custom_show_their_own_icons`. Run `yarn test` (or `npx vitest run`) green.

## 4. Installed-apps store

- [ ] 4.1 Add a small reactive `installedApps` store (in `openWith.svelte.ts` or a sibling) that calls `invoke('installed_apps', { names })` over the union of all `APP_CHOICES` once when requested, caches the result as a `Set<string>`, and resolves to an empty set on failure / non-Tauri (strict).

## 5. Reusable Dropdown component (+ roving helper, TDD)

- [ ] 5.1 Add a pure `rovingIndex(current, key, count)` helper (Down/Up/Home/End, bounds-clamped) and unit-test it: `keyboard_navigation_moves_through_the_options`. Run green.
- [ ] 5.2 Create `src/lib/ui/Dropdown.svelte`: controlled props `value`, `options: {value; label; icon?}[]`, `onChange`, optional `width`/`ariaLabel`. Trigger button (active option icon+label) + popover `role="listbox"` of `role="option"` rows, styled to match `ContextMenu`/`FooterPopover` (fixed-position panel + full-screen scrim). Close on Escape / outside-click / select; arrow/Home/End roving (via 5.1); Enter/Space select; checkmark on the active row; `use:autofocus`.

## 6. Wire the Settings dialog

- [ ] 6.1 In `SettingsModal.svelte`, fetch the installed set when the modal opens (effect, like the voice-model status query).
- [ ] 6.2 Replace the four Open-files `<select>`s with `Dropdown`, building each option list as `[System Default] + visibleChoices(APP_CHOICES[bucket], installed, prefs[bucket]) + [Custom…]`, each option carrying `appIcon(...)`. Keep the existing `Custom…` free-text field behavior.
- [ ] 6.3 Replace the remaining native `<select>`s (Density, Transcription quality, the two Notification selects) with `Dropdown` (no icons), preserving their current values/handlers and disabled states.
- [ ] 6.4 Remove now-unused `<select>` CSS; keep the dialog layout/spacing visually consistent.

## 7. Verify

- [ ] 7.1 `yarn check` (svelte-check/tsc) and lint pass with no new errors/warnings.
- [ ] 7.2 `yarn test` and `cargo test` (in `src-tauri/`) pass; scenario-coverage gate (`node tools/check-scenario-coverage.mjs`) still passes.
- [ ] 7.3 Manual (live in-app, headless-exempt): open Settings — each Open-files dropdown lists only installed apps with icons, keyboard nav + Esc/outside-click work, choosing an app persists and opens correctly; the other dropdowns render via the same control without icons.
