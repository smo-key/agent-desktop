## 1. Foundations — settings & feature flag

- [ ] 1.1 Extend the settings schema (Rust `settings_load`/`settings_save` in `src-tauri/src/lib.rs`) with a `voice` section: `enabled`, `polish` (default true), `modelTier`.
- [ ] 1.2 Add a frontend voice settings store mirroring `src/lib/settings/openWith.svelte.ts` (reactive, persists via `settings_save`).
- [ ] 1.3 Add a "Voice" section to `src/lib/ui/SettingsModal.svelte` (enable toggle, polish toggle, model-tier select).

## 2. Voice panel UI & activation (button)

- [ ] 2.1 Add a voice runes store (open/close + recording state) mirroring `src/lib/launcher/launcherStore.svelte.ts`.
- [ ] 2.2 Build the bottom-center `VoicePanel.svelte` component (fixed bottom-center, z-index above panes) with mic button, recording indicator, live overlay region, and stop control.
- [ ] 2.3 Wire dismissal: Escape, click-outside, and stop control all close the panel and stop recording; enforce single-instance.
- [ ] 2.4 Mount the panel from `src/routes/+page.svelte` and add an on-screen mic button entry point that opens it (respecting the `enabled` setting).

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

- [ ] 7.1 Add a Rust native `NSEvent` global monitor for `flagsChanged` detecting two right-Command presses within the double-tap window (~400ms), isolated in its own module.
- [ ] 7.2 Emit a Tauri event on detection; have the frontend listen and open the panel (respecting the `enabled` setting); ensure failure of the monitor still leaves the mic button working.

## 8. Insertion into focused agent terminal

- [ ] 8.1 Insert the finished text verbatim via `TerminalHandle.send(text)` (`src/lib/layout/terminals.ts`) to the focused agent terminal with NO trailing carriage return (study `src/lib/launcher/initialInput.ts` for verbatim guarantees).
- [ ] 8.2 Handle the no-focused-agent-terminal case with a clear "no target" state; never send text to an unexpected target.
- [ ] 8.3 Register the activation gesture/button in `src/lib/ui/shortcuts.ts` so the help modal documents it.

## 9. Verification

- [ ] 9.1 Verify end-to-end on Apple Silicon: button + double-tap right-Cmd open the panel, live overlay updates while speaking, final clean text lands verbatim (no auto-submit) in the focused terminal.
- [ ] 9.2 Verify polish toggle (on → cleaned, off → raw), permission-denied guidance, silence produces no text, and graceful degradation when the polish LLM is unavailable.
- [ ] 9.3 Run the project's build/test/lint; confirm the signed/notarized build captures mic audio (entitlement + Info.plist correct).
