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

### D4 — Frontend: full-message retention with a 6s sliding REPROCESS window
The overlay must show the **entire** message (older text is never dropped), but each
tick may only re-transcribe a bounded amount of recent audio — a **6s sliding
window** (`REPROCESS_WINDOW_SEC = 6`). Audio that scrolls past 6s old is finalized
once into committed text and never reprocessed:

- The pipeline tracks `committed: string` (finalized text, never re-transcribed) and
  `committedSamples: number` (PCM folded into `committed`).
- On each ~100ms tick (in-flight guarded), with `end = total captured samples`:
  - **Finalize older audio in SUBSTANTIAL chunks:** `commitCut` only fires once the
    un-finalized span exceeds **2×** `REPROCESS_WINDOW_SEC`, then cuts to leave 6s
    trailing — so each committed chunk is ~6s. (Firing at 1× would finalize a tiny
    ~per-tick sliver every 100ms; whisper transcribes ~100ms fragments to
    empty/garbage, so `committed` never accumulates and older text is lost — the
    "cuts off" bug.) The cut prefers a **silence boundary** near `end − 6s` so a word
    isn't split (force-cut at the target otherwise). Transcribe `pcm[committedSamples..cut]`
    via `voice_transcribe_partial`, append to `committed`, set `committedSamples = cut`.
    Consequence: the per-tick reprocess span oscillates between 6s and 12s (still
    bounded and fast on the resident tiny model), not a strict 6s.
  - **Reprocess the window:** transcribe the trailing `pcm[committedSamples..end]`
    (≤ ~6s) each tick → `windowText`.
  - **Overlay** = `committed` + (space) + `windowText` via `voiceStore.setPartial`,
    so the whole message shows while only ≤6s is reprocessed per tick.
- `PARTIAL_INTERVAL_MS` → 100. The old rolling-window-that-DROPS-old-text behavior
  is REMOVED. Reset `committed`/`committedSamples` on each panel open. The final
  pass is unchanged and still re-transcribes the full utterance authoritatively.

`voice_transcribe_partial(pcm, sample_rate)` stays **stateless** — it transcribes
exactly the PCM slice it's given (the finalize segment or the 6s window); all
retention/concatenation state lives in the frontend, where `commitCut` is pure +
unit-tested.
*Alternative (rejected):* a rolling window that only shows the last N seconds —
loses older text (the bug being fixed). Re-transcribing the whole utterance each
tick — defeats the latency goal on long takes.

### D5 — Provisioning: build `whisper-server` statically alongside `whisper-cli`
Extend `scripts/fetch-whisper.sh` to also build the `whisper-server` target with
`-DBUILD_SHARED_LIBS=OFF` (so it's self-contained like `whisper-cli`) and drop it
at `src-tauri/binaries/whisper-server-aarch64-apple-darwin`. Register in
`tauri.conf.json` `bundle.externalBin` and add a `shell:allow-execute` scope entry
in `capabilities/default.json`. A git-ignored placeholder keeps `cargo build`
green without the real binary (same pattern as whisper-cli / llama-server).

### D6 — Escape cancels the panel even when a TUI is focused
The voice panel floats over a terminal-first app; while recording, an xterm pane is
usually focused. xterm handles keydown on its own textarea and stops propagation,
so a bubble-phase `svelte:window` Escape listener never fires — Escape went to the
TUI instead of cancelling dictation. Fix: while the panel is open, register a
**capture-phase** `keydown` listener on `window` (`addEventListener('keydown', h, true)`)
that intercepts Escape FIRST (capture runs top-down, before the focused xterm),
`preventDefault` + `stopImmediatePropagation` so the TUI never sees it, and
discards the panel. Only active while open, so Escape behaves normally otherwise.
This makes the existing `voice-dictation` "Escape cancels" behavior actually hold
over a focused terminal — captured as a MODIFIED delta to that capability here.

### D7 — No click-outside dismissal (remove the scrim)
The panel originally rendered a transparent full-screen `.voice-scrim` button
behind it whose only jobs were (a) catch a click-outside → `discard()` and (b)
incidentally block those clicks from reaching the app. Both are wrong for a
non-modal dictation overlay: a stray click while dictating (e.g. refocusing a
terminal) would silently cancel, and the scrim made the whole app inert behind
the panel. Fix: **remove the scrim entirely.** Clicking outside the panel now
does nothing to it and the click passes through to the app, which stays
interactive while dictating. Dismissal is explicit only — the × cancel, Escape
(D6 capture), or the ✓ confirm. Captured as a MODIFIED delta to the
`voice-dictation` "Open and close the voice panel" requirement (dropping
"click outside the panel" from the dismissal list + a new scenario that an
outside click keeps the panel open and reaches the app).
*Alternative (rejected):* keep the scrim but make its onclick a no-op — still
blocks clicks to the app for no benefit; removing it is simpler and correct.

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
