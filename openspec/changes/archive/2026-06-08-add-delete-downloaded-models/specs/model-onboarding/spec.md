# model-onboarding Specification (delta)

## ADDED Requirements

### Requirement: Delete downloaded models from Settings

The Settings UI SHALL provide a control to delete the downloaded on-device models
and reclaim their disk space. The control SHALL display the total reclaimable size
and SHALL be unavailable (or indicate "none downloaded") when no downloaded models
are present.

Activating the control SHALL delete every downloaded model file (the whisper tier
models and the polish LLM) together with any interrupted-download `.part` leftover,
and SHALL NOT delete the bundled model (which ships with the app and is never a
downloaded file). Deletion SHALL be best-effort and idempotent: an already-absent
file is a no-op, and one file that cannot be removed SHALL NOT abort removal of the
others. After deletion the Settings UI SHALL reflect the freed state — the affected
models appear as available to download again — and any model needed later is
re-downloaded on demand.

#### Scenario: Delete downloaded models frees disk space

- **WHEN** one or more downloaded models are present and the user activates the
  delete control in Settings
- **THEN** those model files (and any `.part` leftovers) are removed, the reclaimed
  size is freed, and the UI updates to show the models as downloadable again

#### Scenario: Nothing to delete when no models are downloaded

- **WHEN** no downloaded models are present on disk
- **THEN** the delete control is unavailable (it indicates there is nothing to
  reclaim) rather than performing a no-op deletion

#### Scenario: Bundled model is never deleted

- **WHEN** the user deletes downloaded models
- **THEN** the bundled model is preserved, so first-run/offline transcription keeps
  working after the deletion
