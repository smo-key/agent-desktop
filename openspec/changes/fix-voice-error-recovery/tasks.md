## 1. Store: in-place recovery

- [x] 1.1 Add a `session` capture-session counter to `VoiceStore` (the dependency
      VoicePanel's pipeline effect watches to rebuild a spent pipeline).
- [x] 1.2 Add `retry()`: clear error + partial, return to `idle`, bump `session`.
      No-op while closed. (`finalText` is preserved — see 4.6.)
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

## 4. Adversarial-review fixes (2 independent reviewers, both CRITICAL-flagged)

- [x] 4.1 `MicCapture`: add a `#stopped` flag so a `stop()` issued while
      `getUserMedia` is pending releases the stream granted afterwards. Without it
      the OS mic stayed on for the life of the app — and `retry()` is offered in
      exactly the `denied` phase where a fresh permission prompt appears.
      Regression test in a new `capture.test.ts` (jsdom).
- [x] 4.2 `DictationPipeline.cancel()`: always run `#stopCapture()`. The early
      return on `#finished` made VoicePanel's `.then()` teardown recovery — the
      call that runs *after* the stream exists — dead code.
- [x] 4.3 `DictationPipeline.start()`: don't announce `recording` when cancelled
      mid-request, which stranded a CLOSED panel in the recording phase.
- [x] 4.4 Waveform `$effect`: gate on `voiceStore.open` too, so a stray recording
      phase can't pin a 60fps rAF loop forever.
- [x] 4.5 Session fence: bump `session` on `show()` as well as `retry()`, snapshot
      it in `stopAndInsert()`, and re-check after every await (including inside
      `finishDictation`, where the insert/spawn actually happen). Stops an
      abandoned utterance from being typed into the terminal — or spawning an
      agent — and from writing its error over a live session.
- [x] 4.6 `retry()` preserves `finalText`, and the guidance block renders it: a
      failed *insert* means the transcript is good, and the accent-coloured
      primary action was silently destroying it.
- [x] 4.7 `ensureModels` effect depends on `session`, so "Voice models aren't ready
      yet — try again" can actually be retried instead of looping forever.
- [x] 4.8 Test `initVoiceActivation`'s dispatch, not just the pure decision table.

## 5. Second adversarial-review round (both findings caused by round-1 fixes)

- [x] 5.1 Serialize `ensureModels`: task 4.7 made "Try again" re-trigger model
      readiness, but `ensureModels` had no re-entrancy guard and the Rust
      downloader unlinks the in-flight `.part` then renames whatever it finds,
      with existence-only readiness — so two overlapping downloads rename a
      truncated file into place and report it ready forever. Now chained, with
      identical requests collapsing. Tests in `models.test.ts`.
- [x] 5.2 A preserved transcript (task 4.6) must not resurface as the CURRENT
      utterance: clear it once a new capture reaches `recording`, and drop the
      `finalText` fallback from the finalizing row as well as the recording row.

## 6. Third adversarial-review round

- [x] 6.1 Queue only the DOWNLOAD, not the readiness check. Task 5.1's chain put
      the cheap status IPC behind a `curl` that has no timeout, so one stalled
      transfer wedged every later caller — including "Try again" itself. Readiness
      now runs outside the queue; test pins it.
- [x] 6.2 Move `begin()`'s Channel setup inside the try/finally so a throw before
      the invoke can't pin `modelDownload.active` (disabling Settings' Delete and
      the onboarding gate). Pre-existing; fixed while in the function.
- [x] 6.3 Correct a stale comment in VoicePanel claiming `.proc` still uses the
      `finalText` fallback — it no longer does.

## 7. Verify

- [x] 7.1 `yarn run check` clean (0 errors).
- [x] 7.2 `yarn test` green.
- [ ] 7.3 MANUAL: in a live window, force a failed dictation (confirm with no
      speech) and confirm the panel shows "Try again" / "Dismiss", that Try again
      starts a fresh recording, and that a right-⌘ tap also retries.
