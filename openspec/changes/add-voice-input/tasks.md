## 1. Foundations — settings & feature flag

- [x] 1.1 Extend the settings schema with a `voice` section: `enabled`, `polish` (default true), `modelTier`. (Persistence is an opaque JSON blob, so no Rust struct change is needed; the `voice` slice round-trips through the existing `settings_load`/`settings_save`. Added a shared `src/lib/settings/persist.ts` with `loadSettings`/`saveSettingsSlice` so independent slices merge instead of clobbering, and refactored `openWith` onto it.)
- [x] 1.2 Add a frontend voice settings store mirroring `src/lib/settings/openWith.svelte.ts` (reactive, persists via the merge-on-save helper so it never clobbers other slices).
- [x] 1.3 Add a "Voice" section to `src/lib/ui/SettingsModal.svelte` (enable toggle, polish toggle, model-tier select); load the store on mount in `+page.svelte`.

## 2. Voice panel UI & activation (button)

- [x] 2.1 Add a voice runes store (open/close + recording state) mirroring `src/lib/launcher/launcherStore.svelte.ts`. — `src/lib/voice/voiceStore.svelte.ts` (VoiceState + VoiceStore singleton), unit-tested in `voiceStore.test.ts`.
- [x] 2.2 Build the bottom-center `VoicePanel.svelte` component (fixed bottom-center, z-index above panes) with mic button, recording indicator, live overlay region, and stop control. — `src/lib/voice/VoicePanel.svelte` (fixed bottom:24px, z-index 2000; mic indicator reflects state; partial=dim/italic, final=normal; × stop).
- [x] 2.3 Wire dismissal: Escape, click-outside, and stop control all close the panel and stop recording; enforce single-instance. — window-level Esc, transparent scrim click-outside, × button; single-instance via store `show()` no-op. (Capture-stop hook lands in a later slice.)
- [x] 2.4 Mount the panel from `src/routes/+page.svelte` and add an on-screen mic button entry point that opens it (respecting the `enabled` setting). — `<VoicePanel />` mounted by the other root modals; mic button in the title-bar `tb-right` cluster (left of Settings), gated on `voice.prefs.enabled`.

## 3. Microphone capture & permission

- [ ] 3.1 Implement `getUserMedia` audio capture in the webview, started when the panel opens and stopped on close.
- [ ] 3.2 Add macOS mic permission handling: `NSMicrophoneUsageDescription` in Info.plist (via `tauri.conf.json`), `com.apple.security.device.audio-input` entitlement, and capability config under `src-tauri/capabilities/`.
- [ ] 3.3 Detect denied/blocked permission and render guidance to enable mic access in System Settings; block recording until granted.

## 4. whisper.cpp STT sidecar (backend)

- [ ] 4.1 Add a prebuilt `whisper.cpp` arm64 sidecar binary and register it via `tauri.conf.json` `externalBin`/resources; confirm it bundles into the macOS app.
- [ ] 4.2 Add Rust command(s) to run transcription via the sidecar, choosing the audio transport (streamed chunks vs per-window temp WAV) that meets the latency budget.
- [ ] 4.3 Stream live partials to the frontend using the small model over a sliding window (Tauri `Channel<T>`/`emit` pattern, cf. `pty_spawn`).
- [ ] 4.4 Implement VAD silence gating: detect utterance boundaries, discard silent/empty/low-confidence segments (no hallucinated text on silence).
- [ ] 4.5 On end-of-speech, run large-v3-turbo once over the full utterance and return the final transcript.

## 5. Model management

- [ ] 5.1 Bundle the tiny whisper model for instant/offline first use.
- [ ] 5.2 Implement download-on-first-run for large-v3-turbo (and the polish model when enabled), stored under app data with progress reported to the UI.
- [ ] 5.3 Surface download progress / model-readiness state in the panel and settings; honor the `modelTier` setting.

## 6. Transcript polish (local LLM)

- [ ] 6.1 Add the bundled local LLM runtime (MLX server preferred on Apple Silicon; llama.cpp fallback) as a managed subprocess spawned from Rust with a health check.
- [ ] 6.2 Add a Rust command that polishes a transcript with a constrained system prompt (remove fillers/false-starts/repetitions, fix punctuation/caps, agent-ready, add no new content).
- [ ] 6.3 Gate polishing on the `polish` setting: when off, bypass the LLM and use the raw transcript.
- [ ] 6.4 Graceful degradation: if the polish LLM is unavailable/fails, fall back to the raw transcript without blocking insertion.

## 7. Native activation — double-tap right Command

- [x] 7.1 Add a Rust native `NSEvent` global monitor for `flagsChanged` detecting two right-Command presses within the double-tap window (~400ms), isolated in its own module. — `src-tauri/src/voice_activation.rs`. Pure, headless-testable `DoubleTapDetector` (window=400ms; `tap(now_ms)→bool`, resets on a completed pair so a triple-tap doesn't double-fire; handles out-of-order clocks) with 6 unit tests (within/outside window, single tap, triple-tap, exact-boundary, out-of-order). Native monitor uses `objc2`/`objc2-app-kit`/`block2` (already in the tree via the dialog plugin) for keyCode 54 = RIGHT Command on the PRESS edge (command flag set). CAVEAT: a GLOBAL `NSEvent` monitor needs **Accessibility / Input-Monitoring** permission or it silently never fires in the background; the LOCAL monitor (installed too) needs no permission and fires while focused. The live gesture is MANUAL-verify only (NSEvent can't be unit-tested headless) — see task 9.1.
- [x] 7.2 Emit a Tauri event on detection; have the frontend listen and open the panel (respecting the `enabled` setting); ensure failure of the monitor still leaves the mic button working. — On a completed double-tap the monitor emits `voice://activate`; `src/lib/voice/activation.ts` (`initVoiceActivation`) listens and calls `voiceStore.show()` gated on `voice.prefs.enabled`, wired in `+page.svelte` onMount (unlisten captured + cleaned up). `start` is best-effort: any install/lock failure is logged and swallowed (no panic) so the app + the on-screen mic button keep working; on non-macOS `start` is a no-op.

## 8. Insertion into focused agent terminal

- [x] 8.1 Insert the finished text verbatim via `TerminalHandle.sendKeys(text)` (`src/lib/layout/terminals.ts`) to the focused agent terminal with NO trailing carriage return (study `src/lib/launcher/initialInput.ts` for verbatim guarantees). Implemented in `src/lib/voice/insert.ts` (`insertVoiceText`); fully tested in `src/lib/voice/insert.test.ts` (exact-bytes assertion proves no `\r`, multi-line passes through unchanged). NOTE: chose `sendKeys` over `send` — `send` appends a single `\r` (= auto-submit), which the requirement (no auto-submit) forbids; `paste` returns `void` (no dead-pane signal) and is a plain `pty_write` with no bracketed-paste advantage, whereas `sendKeys` writes raw verbatim bytes and reports `false` on a dead PTY.
- [x] 8.2 Handle the no-focused-agent-terminal case with a clear "no target" state; never send text to an unexpected target. `insertVoiceText(undefined, …)` returns `{ ok:false, reason:'no-target' }`; the wired `insertDictation` sets `voiceStore.setError('No focused agent to receive dictation')`. Focused-agent source of truth: `workspace.focusedId` (the active workspace's focused leaf), wrapped in the thin `focusedAgentPaneId()` (project terminals live in a separate panel, never returned). Resolution is injectable/tested via `resolveFocusedAgentHandle`.
- [x] 8.3 Register the activation gesture/button in `src/lib/ui/shortcuts.ts` so the help modal documents it. Added a "Voice" group documenting double-tap right Command (`⌘⌘`) and the mic button.

## 9. Verification

- [ ] 9.1 Verify end-to-end on Apple Silicon: button + double-tap right-Cmd open the panel, live overlay updates while speaking, final clean text lands verbatim (no auto-submit) in the focused terminal.
- [ ] 9.2 Verify polish toggle (on → cleaned, off → raw), permission-denied guidance, silence produces no text, and graceful degradation when the polish LLM is unavailable.
- [ ] 9.3 Run the project's build/test/lint; confirm the signed/notarized build captures mic audio (entitlement + Info.plist correct).
