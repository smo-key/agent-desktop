# Tasks — enrich-open-prs-popover

## 1. Data layer (Rust — `src-tauri/src/pr.rs`)
- [ ] 1.1 Request `author` and `updatedAt` in `gh_open_prs_args`
- [ ] 1.2 Add a `PrAuthor` struct and `author` / `updated_at` fields to `OpenPr`; parse them best-effort in `parse_open_pr_list` (a `parse_pr_author` helper; missing/empty → `None`)
- [ ] 1.3 Update existing `OpenPr` test fixtures; add tests for author + updatedAt parsing (full object, missing fields, empty login, bot flag)

## 2. Data model + pure helpers (TS — `src/lib/projects/openPrsActions.ts`)
- [ ] 2.1 Mirror the Rust shape: add a `PrAuthor` interface and `author` / `updatedAt` to `OpenPr`
- [ ] 2.2 Add pure helpers: `reviewStatus`, `authorAvatarUrl`, `authorInitial`, `authorLabel`, `prUpdatedSeconds`
- [ ] 2.3 Tests for the new helpers; update the `pr()` test fixture

## 3. UI (Svelte)
- [ ] 3.1 Add a neutral `circle` glyph to the vendored icon set (`projectIcons.ts`)
- [ ] 3.2 Add `PrAuthorAvatar.svelte` — `<img>` with initial/bot fallback and a name tooltip
- [ ] 3.3 Enrich each open-PR popover row in `GitInfo.svelte`: avatar, relative updated time (exact on hover), review-status icon; add styles

## 4. Close-out
- [ ] 4.1 `npm run check`, `npm test`, and `cargo test` (pr) pass
- [ ] 4.2 Sync spec delta into `openspec/specs/footer-actions`; archive the change
