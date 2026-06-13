# Sidecar binaries (provisioned, NOT committed)

This directory holds Tauri **sidecar** (`externalBin`) binaries that are
*provisioned at build time*, not checked into git. The actual binaries are
ignored via `src-tauri/.gitignore`; only this README and `.gitkeep` are tracked.

## Cross-platform provisioning (host detection + `TARGET_TRIPLE`)

The provisioning scripts (`scripts/fetch-whisper.sh`, `scripts/fetch-llama.sh`)
derive the **Rust target triple** and **cmake architecture** from the HOST
(`uname -s` / `uname -m`), so each release runner builds its own-arch sidecars
natively. The mapping (see `scripts/lib/target-triple.sh`) is:

| Host (`uname -s` / `-m`) | Target triple | cmake / generator | Binary suffix |
|---|---|---|---|
| Darwin / arm64 | `aarch64-apple-darwin` | `-DCMAKE_OSX_ARCHITECTURES=arm64` | — |
| Darwin / x86_64 | `x86_64-apple-darwin` | `-DCMAKE_OSX_ARCHITECTURES=x86_64` | — |
| Linux / x86_64 | `x86_64-unknown-linux-gnu` | host gcc/clang (no OSX flag) | — |
| Linux / aarch64 | `aarch64-unknown-linux-gnu` | host gcc/clang (no OSX flag) | — |
| MINGW/MSYS / x86_64 | `x86_64-pc-windows-msvc` | Visual Studio (MSVC) generator | `.exe` |

The **default is `aarch64-apple-darwin`** when nothing is detected or overridden,
so existing local Apple-Silicon development is unchanged.

Override the resolved target with the `TARGET_TRIPLE` (and/or `TARGET_ARCH`)
environment variable:

```sh
TARGET_TRIPLE=x86_64-pc-windows-msvc ./scripts/fetch-whisper.sh
```

Each script emits its binaries named `<name>-<triple>` and appends `.exe` on
Windows (e.g. `whisper-cli-x86_64-pc-windows-msvc.exe`). Per OS:

* **macOS** — cmake selects the arch via `-DCMAKE_OSX_ARCHITECTURES`.
* **Linux** — the host's native gcc/clang toolchain builds for the host arch.
* **Windows** — the script runs under **Git Bash** and drives cmake with the
  **Visual Studio / MSVC** generator to emit a NATIVE Windows PE `.exe`. It does
  NOT compile under WSL (that would produce a Linux ELF that cannot be a Windows
  sidecar).

Use **`DRY_RUN=1`** (or `PRINT_TARGET=1`) on either fetch script to print the
resolved triple, cmake arch, suffix, and destination paths without building:

```sh
TARGET_TRIPLE=x86_64-pc-windows-msvc DRY_RUN=1 ./scripts/fetch-whisper.sh
```

### Validation before bundling

`scripts/validate-sidecars.sh [triple]` (default = host, or `TARGET_TRIPLE` env)
checks that each expected sidecar (`whisper-cli`, `whisper-server`,
`llama-server`) exists, is executable, and matches the expected binary FORMAT +
ARCH for the triple (Mach-O for `*-apple-darwin`, ELF for `*-linux-gnu`, PE32+
for `*-windows-msvc`, via the `file` command). It exits non-zero with a clear
message on any missing or mismatched sidecar, so CI fails the build for that
target rather than bundling the wrong binary.

## `whisper-cli` — whisper.cpp speech-to-text

The voice-input feature shells out to whisper.cpp's `whisper-cli` to transcribe
microphone audio on-device (see `src-tauri/src/transcribe.rs`).

Tauri's sidecar convention requires the binary to be named with the target
triple appended, so on Apple Silicon the file is (other targets use their own
triple — see the cross-platform table above):

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

## `whisper-server` — whisper.cpp live-partials runtime

The live-PARTIALS feature runs whisper.cpp's long-lived `whisper-server` with the
**tiny** model loaded once and resident in memory, so each partial is just an
inference (no per-call model reload). It serves `POST /inference` on `127.0.0.1`;
the manager (`src-tauri/src/whisper_server.rs`) starts it lazily and health-checks
`GET /health` before the first request. The FINAL high-quality pass still uses the
one-shot `whisper-cli` + tier model — `whisper-server` is partials-only.

Same sidecar convention — on Apple Silicon the file is (other targets use their
own triple):

```
binaries/whisper-server-aarch64-apple-darwin
```

`tauri.conf.json` registers it as `bundle.externalBin: ["binaries/whisper-server"]`
and `capabilities/default.json` grants `shell:allow-execute` for it as a sidecar.

### Provisioning

`whisper-server` is built by the SAME script as `whisper-cli` (both static targets
from one whisper.cpp checkout):

```sh
./scripts/fetch-whisper.sh
```

### Local placeholder

A git-ignored shell-script PLACEHOLDER `whisper-server-aarch64-apple-darwin` lets
local `cargo build`/tauri-build resolve the sidecar without the real binary
(mirrors `whisper-cli`/`llama-server`). It is not a working server — it exits
non-zero, so a stray partial in dev degrades to no-partials with the final pass
unaffected. A shippable `tauri build` needs the real binary via
`./scripts/fetch-whisper.sh`.

## `llama-server` — llama.cpp transcript-polish runtime

The transcript-POLISH feature shells out to llama.cpp's `llama-server` to clean
up the raw transcript on-device (see `src-tauri/src/polish.rs`). It serves an
OpenAI-compatible `POST /v1/chat/completions` on `127.0.0.1`; the manager starts
it lazily and health-checks `GET /health` before the first request.

Same sidecar convention — on Apple Silicon the file is (other targets use their
own triple):

```
binaries/llama-server-aarch64-apple-darwin
```

`tauri.conf.json` registers it as `bundle.externalBin: ["binaries/llama-server"]`
and `capabilities/default.json` grants `shell:allow-execute` for it as a sidecar.

### Provisioning

```sh
./scripts/fetch-llama.sh
```

Idempotent (skips if a real Mach-O binary is already present; replaces the
committed shell-script placeholder), requires network at build time, commits
nothing.

### Polish model weights

`llama-server` loads the polish GGUF model (Qwen3 1.7B Q4_K_M — the
`models::POLISH` registry entry). It is downloaded to app-data by the
model-management slice's `voice_download_models` when polish is enabled, **not**
bundled here. The `voice_polish` command returns an error (so the frontend falls
back to the raw transcript) if the model is absent.

### Local placeholder

A git-ignored shell-script PLACEHOLDER `llama-server-aarch64-apple-darwin` lets
local `cargo build` resolve the sidecar without the real binary (mirrors
`whisper-cli`). It is not a working server — it exits non-zero so a stray
`voice_polish` in dev degrades to the raw transcript. A shippable `tauri build`
needs the real binary via `./scripts/fetch-llama.sh`.
