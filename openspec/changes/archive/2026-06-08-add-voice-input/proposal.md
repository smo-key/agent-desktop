## Why

Typing prompts into an agent is slow, and the focused interaction in Agent
Desktop is terminal-first — there is no convenient way to compose a long prompt
by voice. Speaking is faster than typing for most prompt-shaped input, but raw
dictation is full of "um/uh", false starts, and run-on phrasing that reads
poorly to an agent. We want a Wispr-Flow-style experience that is **fully
on-device** (no cloud, no transcripts leaving the machine): press a key or a
button, talk, watch a live transcript, and have clean, agent-ready text dropped
into the focused agent's terminal — fast enough that it feels instant.

## What Changes

- Add a **bottom-center voice panel** that opens via (a) an on-screen mic button
  and (b) a **solo tap of the right Command key** (pressed and released alone).
  While recording it shows a **live overlay of the in-progress transcript**
  ("what I'm currently saying").
- Capture microphone audio in the webview (`getUserMedia`) with proper macOS
  **microphone-permission** handling (request, denied-state guidance).
- Transcribe **locally** with a `whisper.cpp` sidecar (Metal-accelerated):
  a small model in a sliding window drives the **live partial** overlay; on
  end-of-speech, **large-v3-turbo** re-runs the full utterance for the clean
  final transcript. Silence is gated with **VAD** to avoid Whisper hallucinating
  text on quiet audio.
- Add an **optional local LLM "polish" pass** (default on, toggleable in
  settings) that removes fillers/false starts/repetitions, fixes
  punctuation/capitalization, and formats the text to be agent-ready. When off,
  the raw transcript is used.
- Insert the finished text **verbatim** into the **currently-focused agent's
  terminal** via the existing send path — **no auto-submit** (the user reviews,
  then presses enter).
- Add a **voice section to settings** (enable, polish on/off, model tier).
- **Packaging:** bundle a tiny whisper model for instant/offline first use;
  **download** large-v3-turbo and the polish LLM on first run with a progress UI;
  models live in app data, not the installer. **Apple Silicon (arm64) only** for v1.
- **Out of scope (v1):** the Fn-key activation gesture, system-wide / cross-app
  dictation, non-macOS platforms, Intel Macs, and any cloud fallback.

## Capabilities

### New Capabilities
- `voice-dictation`: The user-facing voice input flow — activation (mic button +
  right Command tap), the bottom-center panel, the live transcript
  overlay, microphone permission handling, settings, and verbatim insertion of
  the finished text into the focused agent's terminal (no auto-submit).
- `local-transcription`: On-device speech-to-text — the `whisper.cpp` sidecar,
  dual-model (small live partials + large-v3-turbo final), VAD silence gating,
  and model management (bundled tiny model + download-on-first-run with progress).
- `transcript-polish`: The optional on-device LLM cleanup pass that turns a raw
  transcript into clean, agent-ready text, controllable via settings.

### Modified Capabilities
<!-- None — openspec/specs/ is currently empty; this is all net-new behavior. -->

## Impact

- **Frontend (SvelteKit / Svelte 5):** new voice panel + overlay components and a
  runes store (mirroring `launcherStore`); mic capture via `getUserMedia`; a new
  settings section in `SettingsModal.svelte` + a voice settings store (mirroring
  `openWith.svelte.ts`); wiring into the keyboard/activation path
  (`src/routes/+page.svelte`, `src/lib/ui/shortcuts.ts`) and the verbatim
  terminal send path (`src/lib/layout/terminals.ts`, cf.
  `src/lib/launcher/initialInput.ts`).
- **Rust backend (Tauri):** new commands + streaming channels/events for STT and
  polish (cf. `pty_spawn` `Channel<T>` pattern in `src-tauri/src/lib.rs`); a
  native **macOS `NSEvent` monitor** for a solo right-Command tap emitting
  a Tauri event; model download/management; extended settings schema in
  `settings_load`/`settings_save`.
- **Native binaries / packaging:** ship a `whisper.cpp` sidecar (arm64) and a
  bundled local LLM runtime (e.g. an MLX/llama.cpp server subprocess) via
  `tauri.conf.json` `externalBin`/resources; add `NSMicrophoneUsageDescription`
  to Info.plist and the `com.apple.security.device.audio-input` entitlement; app
  must be code-signed + hardened-runtime + notarized or the mic silently fails.
- **Dependencies:** new Rust crates for the NSEvent monitor and process/model
  management; bundled model weights (downloaded, not committed).
- **Privacy:** all audio, transcripts, and polishing stay on-device.
