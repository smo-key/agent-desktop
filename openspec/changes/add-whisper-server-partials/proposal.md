## Why

Live partial transcripts currently call `voice_transcribe_final` (a one-shot
`whisper-cli` process) on every ~200ms tick. `whisper-cli` reloads the model from
disk on every invocation (hundreds of ms), so the live overlay lags noticeably
and cannot approach real-time — the user explicitly wants partials at **≤50ms**.
Keeping the model resident in a long-lived server removes the per-call reload, so
each partial is just inference (tens of ms) over the loaded tiny model.

## What Changes

- Run a long-lived whisper.cpp **`whisper-server`** with the **tiny** model loaded
  persistently in memory, on a fixed localhost port (distinct from llama-server's).
  Lifecycle mirrors the existing `LlamaServer` in `src-tauri/src/polish.rs` (lazy
  start under a guard, child cached only after `/health` is ready, kill-on-unhealthy,
  timeouts).
- Add a `voice_transcribe_partial(pcm, sample_rate)` Tauri command: VAD-gate the
  audio, encode a 16 kHz WAV, POST it to whisper-server's `/inference` endpoint,
  parse and return the text. Reuse the existing pure helpers in `transcribe.rs`
  (`pcm_f32_to_wav_16k_mono`, `has_speech`, `trim_silence`, `strip_nonspeech`).
- Rewire the frontend live-partial loop (`pipeline.ts` `#tickPartial`) to call
  `voice_transcribe_partial` instead of `voice_transcribe_final`, on a **~100ms**
  fixed tick (in-flight guarded). Switch from a rolling window that DROPS old text
  to **full-message retention with a 6s sliding reprocess window**: audio older
  than 6s is finalized once into committed text (never reprocessed); only the
  trailing ≤6s window is re-transcribed each tick. The overlay shows the **entire**
  message (committed + live window) while reprocessing stays bounded to 6s.
- **Graceful degradation:** if whisper-server can't start / times out, partials
  silently no-op (no overlay) — recording and the authoritative final pass are
  unaffected.
- **Provisioning:** extend `scripts/fetch-whisper.sh` to also build the
  `whisper-server` target **statically** (`-DBUILD_SHARED_LIBS=OFF`, like the
  whisper-cli + llama-server fixes) → `src-tauri/binaries/whisper-server-aarch64-apple-darwin`;
  register it in `tauri.conf.json` `bundle.externalBin` + `capabilities/default.json`
  (`shell:allow-execute`), with a git-ignored placeholder so `cargo build` passes.
- **Unchanged:** the final high-quality pass stays `whisper-cli` + the tier/turbo
  model via `voice_transcribe_final`.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `voice-dictation`: the **Open and close the voice panel** requirement is
  strengthened so Escape cancels the panel even when a terminal/TUI is focused
  (intercepted before the focused terminal sees it).
- `local-transcription`: the **Live partial transcription** requirement changes
  its mechanism — partials are produced by a persistent in-memory whisper-server
  (model loaded once) rather than a per-call CLI that reloads the model, to meet
  the low-latency (≤50ms/pass) goal; with graceful degradation when the server is
  unavailable.

## Impact

- **Rust:** new `src-tauri/src/whisper_server.rs` (server manager + the
  `voice_transcribe_partial` command + pure request/response/health helpers);
  registration in `src-tauri/src/lib.rs`; reuses `transcribe.rs` helpers and the
  `http_client` timeout pattern from `polish.rs`.
- **Frontend:** `src/lib/voice/pipeline.ts` `#tickPartial` calls the new command;
  interval → ~100ms; window unchanged.
- **Native binary / packaging:** a second whisper sidecar (`whisper-server`)
  provisioned via `scripts/fetch-whisper.sh`; `tauri.conf.json` externalBin +
  capability scope; git-ignored placeholder.
- **Resource use:** the tiny model stays resident in RAM while a dictation session
  is active (small — tiny is ~75MB); the server is lazy-started on first partial.
- **No change** to the final pass, settings, activation, insertion, or polish.
