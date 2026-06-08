## Why

On-device voice dictation and the overview's session titles need model files that
are not bundled (the `accurate` whisper model ~574 MB and the Qwen3 polish model
~1.8 GB — ~2.4 GB by default). Today those download lazily the first time the
voice panel opens, so a brand-new install silently lacks them: titles never
generate and the first dictation stalls behind a multi-GB download with little
context. There is no first-run moment that tells the user a one-time download is
needed or lets them kick it off deliberately.

## What Changes

- On launch, when the models the current voice selection requires are **missing**,
  the app shows a **full-screen onboarding gate** before the workspace, explaining
  the one-time on-device download and listing what will be fetched (label + size,
  with a total).
- The gate has a primary **"Download models"** action (runs the existing
  `voice_download_models` flow with a live progress bar) and a secondary **"Skip
  for now"** that drops into the app. Skipping leaves voice/titles gracefully
  disabled until the models are present.
- Detection is **presence-based**: the gate appears whenever the required model
  files are absent, and never once they are on disk. "Skip for now" dismisses it
  only for the current session, so it does not nag mid-session but is offered
  again on the next launch while models remain missing.
- The downloaded set is the current default selection (accurate whisper + polish);
  the gate does not add per-model toggles (tier/polish remain changeable in
  Settings, which re-downloads as needed).

## Capabilities

### New Capabilities
- `model-onboarding`: a first-launch, presence-gated, skippable full-screen screen
  that downloads the on-device models the app needs, with live progress.

## Impact

- **Frontend** — `src/lib/onboarding/onboarding.svelte.ts` (new): a store holding
  the model status + session-dismissal, with a pure `shouldShowOnboarding`.
- **Frontend** — `src/lib/voice/models.ts`: add a pure display catalog
  (`downloadRows`, `formatBytes`) mapping missing filenames → label + human size +
  total, mirroring the Rust registry.
- **Frontend** — `src/lib/onboarding/ModelOnboarding.svelte` (new): the full-screen
  overlay; reuses `ensureModels` + the `modelDownload` progress store.
- **Frontend** — `src/routes/+page.svelte`: initialize the onboarding check after
  voice prefs load and render the overlay when visible.
- **No backend change** — `voice_models_status` and `voice_download_models`
  already provide readiness + streaming download.
