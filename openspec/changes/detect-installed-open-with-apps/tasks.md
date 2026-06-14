## 1. Backend: installed-app detection (Rust, TDD)

- [x] 1.1 In `src-tauri/src/lib.rs`, added pure `app_bundle_paths(name, home, roots)` + `detect_installed(names, home, roots)` and the `installed_apps(names) -> Vec<String>` command, probing `APP_ROOTS` (`/Applications`, `~/Applications`, `/System/Applications`, `/System/Applications/Utilities`, `/System/Library/CoreServices`).
- [x] 1.2 Rust unit tests (temp dirs, mirroring `path_within`): `an_app_in_a_standard_directory_is_detected`, `an_absent_app_is_not_detected`, `finder_is_detected_under_core_services` — written RED-first, now green.
- [x] 1.3 Registered `installed_apps` in `generate_handler!` next to `open_path`.

## 2. Brand icons + filled-glyph rendering

- [x] 2.1 Added `src/lib/icons/BrandIcon.svelte` (filled sibling of `Icon.svelte`: `<svg fill={color}>`, no stroke) for the filled single-path brand glyphs.
- [x] 2.2 Created `src/lib/icons/brandIcons.ts`: brand marks vendored from Simple Icons (CC0) for Cursor/VS Code/Zed/Sublime/Chrome/Safari/Firefox/Brave/Arc/Edge, plus hand-authored filled utility glyphs (app, document, folder, system, custom). Provenance documented in the file header.

## 3. Frontend pure logic: filtering + icon mapping (TDD)

- [x] 3.1 Added pure `visibleChoices(all, installed, current)` (strict filter; curated order; keeps `current`).
- [x] 3.2 Added pure `appIcon(name)` + `APP_ICONS` map (brand / category fallback / generic / SYSTEM / CUSTOM).
- [x] 3.3 Extended `openWith.test.ts` (RED-first): 5 `visibleChoices` + 4 `appIcon` cases — all green (29/29 in file).

## 4. Installed-apps store

- [x] 4.1 Added reactive `installedApps` store + `allCandidateApps()` in `openWith.svelte.ts`: queries `installed_apps` over the union of `APP_CHOICES`, caches a `Set`, empty-set on failure/non-Tauri (strict).

## 5. Reusable Dropdown component (+ roving helper, TDD)

- [x] 5.1 Added pure `rovingIndex(current, key, count)` in `src/lib/ui/dropdown.ts` + RED-first test `keyboard navigation moves through the options` (green).
- [x] 5.2 Created `src/lib/ui/Dropdown.svelte`: controlled, fixed-position listbox popover (escapes dialog scroll), scrim + Escape + outside-click close, arrow/Home/End roving, Enter/Space select, checkmark, `BrandIcon` per option, optional `autofocusTrigger`.

## 6. Wire the Settings dialog

- [x] 6.1 `SettingsModal.svelte` loads `installedApps` via `$effect` on modal open.
- [x] 6.2 Open-files rows now use `Dropdown` with `openWithOptions(bucket)` = `[System Default] + visibleChoices(...) + [Custom…]`, each icon-tagged; `Custom…` free-text field preserved.
- [x] 6.3 Density, Transcription quality, and the two Notification selects migrated to `Dropdown` (no icons), values/handlers/disabled preserved.
- [x] 6.4 Removed unused `<select>` CSS; kept `.custom` text-field styling and layout.

## 7. Verify

- [x] 7.1 `npm run check` (svelte-check) — 0 errors, 0 warnings.
- [x] 7.2 `npm run test` — 1178/1178 pass; `cargo test` — my 3 detection tests pass (2 unrelated `events::` socket tests fail pre-existing/environmental: `SUN_LEN` temp-dir path length, reproduced with my change stashed); coverage gate (`node tools/check-scenario-coverage.mjs`) PASS.
- [ ] 7.3 Manual (live in-app, headless-exempt): open Settings — each Open-files dropdown lists only installed apps with icons, keyboard nav + Esc/outside-click work, choosing an app persists and opens correctly; the other dropdowns render via the same control without icons. (Needs live confirmation — cannot run the desktop app headlessly here.)
