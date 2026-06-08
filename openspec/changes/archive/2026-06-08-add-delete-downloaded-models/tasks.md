# Tasks

## 1. Backend

- [x] 1.1 Add pure `deletable_filenames(present)` to `models.rs` (downloadable
  registry models + `.part`, never bundled tiny); unit-test it.
- [x] 1.2 Add `voice_models_disk_usage` (reclaimable bytes) and `voice_delete_models`
  (best-effort delete, returns bytes freed) commands; register in `lib.rs`.

## 2. Frontend

- [x] 2.1 Add `modelsDiskUsage()` / `deleteModels()` invoke wrappers in `models.ts`
  (degrade errors to 0); unit-test the degradation.
- [x] 2.2 Add the "Downloaded models" row + Delete button to `SettingsModal.svelte`,
  refreshing status + usage after delete; disable during delete/active download.

## 3. Verify

- [x] 3.1 `cargo test --lib` (new tests pass; pre-existing `events` socket tests
  unaffected), `npm run check`, `npm run test` all green.
