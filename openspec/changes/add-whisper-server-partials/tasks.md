## 1. Provision whisper-server sidecar

- [ ] 1.1 Extend `scripts/fetch-whisper.sh` to also build the `whisper-server` target statically (`-DBUILD_SHARED_LIBS=OFF`) and install it at `src-tauri/binaries/whisper-server-aarch64-apple-darwin` (idempotent, chmod +x, FORCE supported). Verify the produced binary is self-contained (`otool -L` has no whisper/ggml dylib deps).
- [ ] 1.2 Register the sidecar in `src-tauri/tauri.conf.json` `bundle.externalBin` (`binaries/whisper-server`) and grant `shell:allow-execute` for it in `src-tauri/capabilities/default.json` (scoped, `sidecar:true`). Add a git-ignored placeholder at the binary path so `cargo build`/tauri-build resolves it; document in `src-tauri/binaries/README.md`.

## 2. Rust: WhisperServer manager + partial command

- [ ] 2.1 Create `src-tauri/src/whisper_server.rs` with a `WhisperServer` manager mirroring `polish.rs::LlamaServer`: `OnceCell<CommandChild>` + `start_guard: Mutex<()>`, lazy `ensure_running(app, model_path)`, health via the backoff schedule, child cached ONLY after `/health` is ready, kill-on-unhealthy. Fixed localhost port distinct from llama-server's 8765 (e.g. 8766). Pure, tested `whisper_server_args(model_path, port)` + a tested health-backoff (reuse `polish::health_backoff_schedule` or a local mirror).
- [ ] 2.2 Share the `http_client(timeout)` helper (move it to a small shared location or mirror it) and use it for whisper-server health + inference requests (so a wedged server times out → Err → no partial).
- [ ] 2.3 Add `#[tauri::command] async fn voice_transcribe_partial(app, pcm: Vec<f32>, sample_rate: u32) -> Result<String, String>`: VAD-gate (`transcribe::has_speech`; empty → ""), `trim_silence`, `pcm_f32_to_wav_16k_mono` (reuse), ensure server running on the bundled tiny model (`voice_bundled_model_path`), POST the WAV to `/inference` as multipart (`file`, `response_format=json`, no-timestamps/temperature 0), parse the text, `strip_nonspeech`. Pure, tested `parse_inference_response(json)` (tolerant of the `{text}`/segment shapes). Stateless — transcribes exactly the slice given.
- [ ] 2.4 Register `voice_transcribe_partial` + `mod whisper_server;` in `src-tauri/src/lib.rs` (additive). Confirm `cargo build` + new `cargo test` pass.

## 3. Frontend: segment concatenation

- [ ] 3.1 Add a pure, tested `nextSegmentCut(pending: Float32Array, sampleRate, opts)` helper (e.g. in `src/lib/voice/segment.ts`): returns the sample index to finalize — end of a speech run before a silence gap once the segment ≥ `minSec`, or `maxSec` force-cut, else `null`. Unit-test: silence-boundary cut, force-cut at max, null when too short / all-speech-too-short.
- [ ] 3.2 Rewire `pipeline.ts` `#tickPartial` to incremental concatenation: track `#committed` text + `#processedSamples`; each ~100ms tick compute `pending`, call `nextSegmentCut`; on a cut, transcribe `pending[0..cut]` via `voice_transcribe_partial`, append to `#committed`, advance offset; transcribe the bounded open tail as a provisional preview; set `voiceStore.setPartial(committed + tail)`. Reset state on open. Keep the in-flight guard.
- [ ] 3.3 Set `PARTIAL_INTERVAL_MS` → 100; remove the rolling `PARTIAL_WINDOW_SEC` (replace with `MAX_SEGMENT_SEC` used by `nextSegmentCut`). The FINAL pass (`stopAndInsert` → `voice_transcribe_final`) stays UNCHANGED and still uses the whole utterance + tier model.
- [ ] 3.4 Drop the now-unused partial model-path resolution on the TS side (the server owns the tiny model); `#startPartials` just starts the loop best-effort.

## 4. Verify

- [ ] 4.1 `npm run check` (0 errors), `npm test`, scenario-coverage gate, `cargo build` + new `cargo test` all green.
- [ ] 4.2 MANUAL (live): provision `whisper-server` (`./scripts/fetch-whisper.sh`), run `tauri dev`, confirm partials appear within ~tens of ms, accumulate the whole message via concatenation (earlier text not reprocessed/garbled), and that killing/omitting the server degrades to no-partials with the final pass still working.
