## Context

The `add-voice-input` change shipped live partials via `pipeline.ts` `#tickPartial`
calling the `voice_transcribe_final` Tauri command (`transcribe.rs`), which spawns
a one-shot `whisper-cli` per tick. `whisper-cli` reloads the model on every spawn,
so partials are slow regardless of tick rate. The codebase already runs a
long-lived sidecar HTTP server for polish — `LlamaServer` in `src-tauri/src/polish.rs`
— with a clean, reviewed lifecycle (lazy start under `start_guard`, child cached in
a `OnceCell` only after `/health` succeeds, kill-on-unhealthy, `http_client(timeout)`
helper, fixed localhost port). whisper.cpp ships a `whisper-server` binary with the
same shape (loads a model once, serves `POST /inference`).

## Goals / Non-Goals

**Goals**
- Live partials at ≤50ms per pass by keeping the tiny model resident in a
  persistent `whisper-server`.
- Reuse the proven `LlamaServer` lifecycle pattern (don't reinvent it).
- Graceful degradation: server problems never block recording or the final pass.

**Non-Goals**
- Changing the final high-quality pass (stays `whisper-cli` + tier/turbo model).
- A multi-model server, model hot-swapping, or websocket/streaming transcription.
- Non-macOS platforms.

## Decisions

### D1 — Persistent `whisper-server`, lifecycle mirrors `LlamaServer`
A new `WhisperServer` manager in `src-tauri/src/whisper_server.rs` with the same
structure as `LlamaServer`: `OnceCell<CommandChild>` + `start_guard: Mutex<()>`,
lazy `ensure_running`, health-checked via the existing backoff schedule, child
cached only after healthy, killed on unhealthy. Spawn args load the **tiny** model
and bind `127.0.0.1:<port>` (a fixed port distinct from llama-server's 8765, e.g.
8766). Factor the shared `http_client(timeout)` helper so both servers use it
(move it to a small shared spot or duplicate minimally).
*Alternative:* reuse llama-server's manager generically — rejected; the args /
endpoint / port differ enough that a parallel struct is clearer than a premature
abstraction.

### D2 — Tiny model for partials; final pass unchanged
The server loads the **bundled tiny** model (`voice_bundled_model_path`) — fast and
always present offline. The final pass keeps using `voice_transcribe_final`
(`whisper-cli` + tier/turbo) for accuracy. So at most the tiny model is resident
during recording; turbo is still a one-shot at end-of-speech.
*Alternative:* one server for both partials and final — rejected; partials want
speed (tiny), final wants accuracy (turbo), and whisper-server holds one model.

### D3 — `voice_transcribe_partial` command, reuses transcribe.rs helpers
`#[tauri::command] async fn voice_transcribe_partial(app, pcm: Vec<f32>, sample_rate: u32) -> Result<String, String>`:
VAD-gate (`has_speech`; empty → `""`), `trim_silence`, `pcm_f32_to_wav_16k_mono`,
ensure the server is running, POST the WAV to `/inference` as multipart form
(`file`, `response_format=json`, `no_timestamps=true`/`temperature=0`), parse the
text (pure parser, mirrors `parse_whisper_json`/`parse_chat_content`), apply
`strip_nonspeech`. On any error → `Err` (frontend swallows; overlay just doesn't
update).
*Audio transport:* a small in-memory WAV per pass (no temp file needed — POST the
bytes directly via multipart), since the request is short-lived.

### D4 — Frontend: incremental SEGMENT CONCATENATION (not rolling re-transcribe)
The overlay must show the **entire** message, but we must NOT re-transcribe the
whole utterance each tick (the latency goal). So partials are built by transcribing
only **new** audio and **concatenating** the result onto a growing committed
transcript:

- The pipeline tracks `committed: string` (concatenated text of finalized segments)
  and `processedSamples: number` (how much PCM has been finalized).
- On each ~100ms tick (in-flight guarded), `pending = pcm[processedSamples..end]`.
  A pure helper `nextSegmentCut(pending, sampleRate, {minSec, maxSec, silence})`
  picks a cut at the end of a speech run followed by a silence gap once the segment
  is at least `minSec`, or force-cuts at `maxSec` (so an unbroken monologue still
  advances). It returns `null` when there isn't enough new audio / no boundary yet.
- When a cut is returned: transcribe **only** `pending[0..cut]` via
  `voice_transcribe_partial`, append its text to `committed`, and advance
  `processedSamples` by `cut`. Cutting on a silence boundary avoids splitting words.
- The OPEN tail (`pending` after the cut, bounded by `maxSec`) is transcribed each
  tick as a provisional preview shown after `committed` (visually distinct). This
  is the only audio re-processed, and it's small/bounded — never the whole message.
- Overlay = `committed` + provisional tail. `voiceStore.setPartial` carries this.
- `PARTIAL_INTERVAL_MS` → 100. The old `PARTIAL_WINDOW_SEC` rolling window is
  REMOVED in favor of `MAX_SEGMENT_SEC` (force-cut bound, ~8–10s). Reset
  `committed`/`processedSamples` on each panel open. The final pass is unchanged
  and still re-transcribes the full utterance for the authoritative result.

`voice_transcribe_partial(pcm, sample_rate)` stays **stateless** — it transcribes
exactly the PCM slice it's given (segment or tail); all segmentation/concatenation
state lives in the frontend, where `nextSegmentCut` is pure + unit-tested.
*Alternative (rejected):* re-transcribe a fixed trailing window each tick — either
loses early text or reprocesses the whole message; the user wants the full message
without reprocessing.

### D5 — Provisioning: build `whisper-server` statically alongside `whisper-cli`
Extend `scripts/fetch-whisper.sh` to also build the `whisper-server` target with
`-DBUILD_SHARED_LIBS=OFF` (so it's self-contained like `whisper-cli`) and drop it
at `src-tauri/binaries/whisper-server-aarch64-apple-darwin`. Register in
`tauri.conf.json` `bundle.externalBin` and add a `shell:allow-execute` scope entry
in `capabilities/default.json`. A git-ignored placeholder keeps `cargo build`
green without the real binary (same pattern as whisper-cli / llama-server).

## Risks / Trade-offs

- **Whisper-server `/inference` API shape differs across versions** → keep the
  request/response handling tolerant (parse the common `{text: ...}` / segment
  shapes; treat parse failure as no-partial) and pin the build tag in the fetch
  script (already pinned for whisper.cpp).
- **A second resident server adds RAM/CPU while recording** → tiny model is small;
  server is lazy-started on first partial and the OS reaps it on exit (same caveat
  as llama-server: a hard crash can leave it bound on the fixed port — mitigated by
  health-check-before-cache + kill-on-unhealthy).
- **~100ms tick is aggressive** → the in-flight guard means we never queue/overlap;
  effective rate is min(100ms, one inference). Acceptable; if Metal contention with
  the final turbo pass is an issue, the final pass runs after partials stop.
- **Fixed port collision** (8766 already in use) → health-check catches it
  (connects to the wrong thing or fails) → degrade to no partials; the final pass
  is unaffected. (Dynamic ports are a possible future improvement, shared with
  llama-server.)

## Open Questions

- Exact `/inference` form-field names/params for the pinned whisper.cpp tag —
  settle during build by checking the server example; the parser stays tolerant.
- Whether to later unify `WhisperServer` + `LlamaServer` behind one generic
  sidecar-server helper (deferred; two concrete structs are fine for now).
