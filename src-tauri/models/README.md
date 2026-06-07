# Bundled model weights (provisioned, NOT committed)

This directory holds the **bundled** whisper model that ships *inside* the app as
a Tauri **resource** (`tauri.conf.json` → `bundle.resources`). The weights are
*provisioned at build time*, not checked into git (they're large — the tiny model
alone is ~75 MB). Only this README and `.gitkeep` are tracked.

## `ggml-tiny.bin` — bundled, instant/offline first use

The voice-input feature bundles the tiny whisper model so transcription works on
first run with **no network** (see `src-tauri/src/models.rs` `TINY` and
`src-tauri/src/lib.rs` `voice_bundled_model_path`, which resolves it from the
app's resource dir). Larger, higher-quality models (`small` for the *fast* tier,
`large-v3-turbo` for the *accurate* tier) and the polish LLM are **downloaded on
first use** into `<app_data_dir>/models/` — they are NOT bundled, keeping the
installer small (`voice_download_models` in `models.rs`).

### Provisioning

Run the fetch script from the repo root — it downloads the bundled model here
with the correct name:

```sh
./scripts/fetch-models.sh
```

The script is idempotent (skips if the file is already present) and requires
network access at build time. It does **not** commit anything.

### Local `cargo build` placeholder

So a local `cargo build` / dev run can resolve the `bundle.resources` entry
without the real 75 MB file, a small git-ignored placeholder `ggml-tiny.bin` may
exist here (mirrors how `binaries/` handles the sidecar placeholder). A real,
shippable `tauri build` MUST have the genuine model present — run the fetch
script first (MANUAL). At runtime `voice_bundled_model_path` only returns the
path when the file actually exists, so a placeholder/absent resource degrades to
the downloaded models rather than feeding garbage to whisper.
