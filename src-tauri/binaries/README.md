# Sidecar binaries (provisioned, NOT committed)

This directory holds Tauri **sidecar** (`externalBin`) binaries that are
*provisioned at build time*, not checked into git. The actual binaries are
ignored via `src-tauri/.gitignore`; only this README and `.gitkeep` are tracked.

## `whisper-cli` — whisper.cpp speech-to-text

The voice-input feature shells out to whisper.cpp's `whisper-cli` to transcribe
microphone audio on-device (see `src-tauri/src/transcribe.rs`).

Tauri's sidecar convention requires the binary to be named with the target
triple appended, so on Apple Silicon the file must be:

```
binaries/whisper-cli-aarch64-apple-darwin
```

`tauri.conf.json` registers it as `bundle.externalBin: ["binaries/whisper-cli"]`
(Tauri appends the triple automatically when bundling) and
`capabilities/default.json` grants `shell:allow-execute` for it as a sidecar.

### Provisioning

Run the fetch script from the repo root — it downloads or builds the binary and
drops it here with the correct name and exec bit:

```sh
./scripts/fetch-whisper.sh
```

The script is idempotent (skips if the binary is already present) and requires
network access at build time. It does **not** commit anything.

### Model weights

`whisper-cli` also needs model weights (`ggml-*.bin`). Those are handled by the
model-management slice (downloaded to app-data on first run), **not** bundled
here, so the installer stays small. For a local MANUAL end-to-end test you can
fetch a tiny model and pass its path to `voice_transcribe_final`.
