# Add "delete downloaded models" to Settings

## Why

On-device models (whisper tiers + the polish LLM) total up to ~2.9 GB on disk and
are downloaded on demand. There is currently no way to reclaim that space from the
app — a user who tried voice/titles once is stuck with multi-GB files. Settings
should let them delete the downloaded models.

## What changes

- Add a **"Downloaded models"** row to the Settings modal's Voice section with a
  single **Delete** button that shows the reclaimable size (e.g. "Delete (1.8 GB)")
  and deletes **all** downloaded models in one click (delete-immediately; no
  confirmation). When nothing is downloaded the row shows "None downloaded".
- After deletion the UI refreshes so the affected models show as downloadable again.
- Backend: a pure `deletable_filenames` selector (downloadable registry models +
  `.part` leftovers, never the bundled tiny model), plus two commands —
  `voice_models_disk_usage` (reclaimable bytes) and `voice_delete_models` (deletes,
  returns bytes freed). Deletion is best-effort and idempotent.

## Impact

- Affected specs: `model-onboarding` (new "Delete downloaded models" requirement)
- Affected code: `src-tauri/src/models.rs` (selector + 2 commands + tests),
  `src-tauri/src/lib.rs` (register commands), `src/lib/voice/models.ts`
  (`modelsDiskUsage` / `deleteModels` wrappers + tests),
  `src/lib/ui/SettingsModal.svelte` (the row + delete action).
