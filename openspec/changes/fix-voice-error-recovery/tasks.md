## 1. Store: in-place recovery

- [x] 1.1 Add a `session` capture-session counter to `VoiceStore` (the dependency
      VoicePanel's pipeline effect watches to rebuild a spent pipeline).
- [x] 1.2 Add `retry()`: clear error + partial + finalText, return to `idle`, bump
      `session`. No-op while closed.
- [x] 1.3 Give `setError(msg, phase = 'error')` an explicit phase so `'denied'`
      survives instead of being clobbered to `'error'`.
- [x] 1.4 Tests in `voiceStore.test.ts` for retry (open/closed/from-denied) and
      for the denied phase surviving the error message.

## 2. Activation: the right-⌘ tap is never inert

- [x] 2.1 Extract the pure `activationAction(enabled, open, state)` decision from
      `initVoiceActivation`, returning `ignore | open | retry | finalize`.
- [x] 2.2 Route the failure phases (`error` / `denied`) to `retry`; keep
      open/finalize behaviour otherwise.
- [x] 2.3 Tests in a new `activation.test.ts` covering every phase.

## 3. Panel: an on-screen way out

- [x] 3.1 Add "Try again" + "Dismiss" controls to the denied/error guidance block,
      styled from the DESIGN.md button-primary / button-ghost recipes.
- [x] 3.2 Make the pipeline `$effect` depend on `voiceStore.session` so retry
      discards the spent pipeline and starts a fresh capture.
- [x] 3.3 Pass `'denied'` explicitly to `setError` for a blocked mic, and drop the
      now-redundant `setState('denied')`.

## 4. Verify

- [x] 4.1 `yarn run check` clean (0 errors).
- [x] 4.2 `yarn test` green.
- [ ] 4.3 MANUAL: in a live window, force a failed dictation (confirm with no
      speech) and confirm the panel shows "Try again" / "Dismiss", that Try again
      starts a fresh recording, and that a right-⌘ tap also retries.
