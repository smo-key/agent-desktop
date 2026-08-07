## Why

A failed voice input trapped the user in the voice panel with an error message
that could not be dismissed from screen.

Every failure path in `DictationPipeline.stopAndInsert()` — no model on disk, an
empty capture, whisper returning nothing, a `no-target` / `dead-pane` insert, or a
thrown exception — calls `voiceStore.setError(...)` and *deliberately* keeps the
panel open so the user sees the result. But three things then conspired:

1. VoicePanel's `denied || error` branch rendered the guidance block with **no
   controls at all** — the `✓` confirm and `×` cancel live only in the recording
   branch it replaces.
2. The pipeline was already `#finished` with the mic released, so the right-⌘ tap
   routed to `stopAndInsert()` and bailed on its `state !== 'recording'` guard.
   The primary gesture was inert.
3. The footer mic FAB is hidden while the panel is open, so there was no other
   entry point.

Escape still worked, but nothing on screen said so — while the message itself
read "Didn't catch that — try again." with no way to try again. This also
violated the existing requirement that the panel be "dismissable via the Escape
key **and an explicit stop/close control**".

A second, related defect surfaced in the same area: `setError` hard-forced the
phase to `error`, clobbering the `denied` phase VoicePanel set one line earlier —
so the System Settings hint, which only renders while denied, never appeared.

## What Changes

- **Explicit controls on the guidance block.** "Try again" and "Dismiss" render
  alongside the error/denied message, so the failure phases are never a dead end.
- **In-place recovery.** New `voiceStore.retry()` clears the error and
  transcripts, returns to idle, and bumps a new `session` counter that
  VoicePanel's pipeline `$effect` depends on — tearing down the spent pipeline
  and building a fresh one without the panel closing.
- **The activation tap recovers.** A new pure `activationAction(enabled, open,
  state)` routes a right-⌘ tap to retry while errored/denied, and keeps the
  existing open/finalize behaviour otherwise.
- **`setError` takes an explicit phase** (`'error' | 'denied'`, default
  `'error'`) so recording the denial message preserves the denied phase and its
  System Settings hint.

## Impact

- Affected specs: `voice-dictation`.
- Affected code: `src/lib/voice/voiceStore.svelte.ts`,
  `src/lib/voice/activation.ts`, `src/lib/voice/VoicePanel.svelte`.
- No change to the capture, transcription, polish, or insertion paths — the
  failure *detection* was already correct; only the recovery affordance was
  missing.
