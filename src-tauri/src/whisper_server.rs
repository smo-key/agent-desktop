//! Low-latency LIVE PARTIAL transcription via a persistent whisper.cpp
//! `whisper-server` sidecar (the tiny model loaded ONCE and resident in memory).
//!
//! ## Why a server (not the one-shot CLI)
//! The FINAL pass ([`crate::transcribe::voice_transcribe_final`]) spawns a
//! one-shot `whisper-cli` per call, which reloads the model from disk every time
//! (hundreds of ms). That is fine for a single end-of-speech pass but far too slow
//! for the live overlay, which the user wants at ≤50ms per pass. A long-lived
//! `whisper-server` keeps the tiny model loaded, so each partial is just inference
//! (tens of ms) over an in-memory model.
//!
//! ## Structure mirrors [`crate::polish::LlamaServer`]
//! Same proven lifecycle: an `OnceCell<CommandChild>` for the single spawned child
//! + a `tokio::Mutex` (`start_guard`) serializing the lazy start, `ensure_running`
//! that re-checks under the guard, spawns via `app.shell().sidecar(...)`, waits for
//! `/health`, caches the child ONLY after it is healthy, and kills it on an
//! unhealthy start. The health-poll backoff reuses
//! [`crate::polish::health_backoff_schedule`]. A fixed localhost port
//! ([`WHISPER_PORT`], distinct from llama-server's 8765) is fine since exactly one
//! instance is lazily started per app process.
//!
//! As with polish, this module is split into PURE, unit-tested helpers (the
//! argument builder + the `/inference` response parser) and the thin
//! manager/command surface that wires them to the actual sidecar + HTTP. The live
//! path only fully RUNS with the provisioned `whisper-server` binary + the bundled
//! tiny model on disk + real audio (MANUAL); it COMPILES regardless. Every failure
//! returns `Err`, so the frontend degrades to no-partials without affecting
//! recording or the authoritative final pass (spec: graceful degradation).

use once_cell::sync::OnceCell;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::models;
use crate::polish::health_backoff_schedule;

/// Localhost port the partials `whisper-server` listens on. Fixed and distinct
/// from the polish llama-server's 8765 so the two resident servers never collide.
const WHISPER_PORT: u16 = 8766;

/// Health-check schedule for the lazy start. The server takes a moment to load the
/// tiny model + bind the port; we poll `/health` with a capped exponential backoff
/// before giving up (degrade to no-partials).
const HEALTH_MAX_ATTEMPTS: u32 = 8;
const HEALTH_BASE_MS: u64 = 150;

// --- Pure helper: whisper-server argument builder ---------------------------

/// Build the `whisper-server` argument vector for serving `model_path` on
/// `127.0.0.1:<port>`. Flags (whisper.cpp `whisper-server`):
///   `-m <model>`        model weights path (kept resident)
///   `--host 127.0.0.1`  bind to localhost only (never exposed off-box)
///   `--port <p>`        the serving port
///   `-nt`               no per-token timestamps — partials only want the text
pub fn whisper_server_args(model_path: &str, port: u16) -> Vec<String> {
    vec![
        "-m".to_string(),
        model_path.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "-nt".to_string(),
    ]
}

/// The base URL for the local whisper-server.
fn server_base(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

// --- Pure helper: /inference response parser --------------------------------

/// Extract the transcript text from whisper-server's `POST /inference` JSON
/// response, TOLERANT of the shapes different whisper.cpp tags emit:
///   - `{ "text": " hello world" }`                    (the common server shape)
///   - `{ "transcription": [ { "text": " hello" }, … ] }`  (the CLI/`-oj` shape)
///
/// The concatenated text is trimmed and run through
/// [`crate::transcribe::strip_nonspeech`] (so a noise-only window yields ""). A
/// well-formed response that simply carries no text yields an empty string (not an
/// error — silence legitimately produces nothing). Malformed JSON, or a JSON value
/// that carries NEITHER recognized shape, is an `Err` (the caller degrades to no
/// partial).
pub fn parse_inference_response(json: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(json.trim()).map_err(|e| format!("parse inference json: {e}"))?;

    // Shape 1: top-level `text` string.
    if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
        return Ok(crate::transcribe::strip_nonspeech(text));
    }

    // Shape 2: `transcription` array of `{ text }` segments.
    if let Some(segments) = v.get("transcription").and_then(|t| t.as_array()) {
        let joined: String = segments
            .iter()
            .filter_map(|seg| seg.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("");
        return Ok(crate::transcribe::strip_nonspeech(&joined));
    }

    Err("inference response: no `text` or `transcription` field".to_string())
}

// --- whisper-server manager -------------------------------------------------

/// The single managed `whisper-server` instance for live partials. Held in
/// Tauri-managed state (one per app process). The child handle is kept so the OS
/// reaps it on app exit; `child` (a `OnceCell`) guards lazy single-start and the
/// `start_guard` `Mutex` serializes the async start + health check so two
/// concurrent partial calls don't both spawn a server.
#[derive(Default)]
pub struct WhisperServer {
    /// The spawned sidecar's child handle, set once on first successful start.
    child: OnceCell<tauri_plugin_shell::process::CommandChild>,
    /// Serializes lazy start + health check across concurrent callers.
    start_guard: Mutex<()>,
}

impl WhisperServer {
    /// Whether the server has already been started this process.
    fn is_started(&self) -> bool {
        self.child.get().is_some()
    }

    /// Ensure the `whisper-server` sidecar is running and healthy, starting it
    /// lazily on the first call. Serialized by `start_guard` so concurrent callers
    /// don't double-spawn. Returns `Err` (so partials degrade to none) if the
    /// sidecar can't be spawned or never becomes healthy.
    ///
    /// Only fully RUNS with the provisioned `whisper-server` binary + the tiny
    /// model on disk (MANUAL); it COMPILES regardless.
    async fn ensure_running(&self, app: &AppHandle, model_path: &str) -> Result<(), String> {
        if self.is_started() {
            // Already spawned this process; confirm it still answers /health.
            return self.wait_healthy().await;
        }
        let _guard = self.start_guard.lock().await;
        // Re-check under the lock (another caller may have started it while we
        // waited for the guard).
        if self.is_started() {
            return self.wait_healthy().await;
        }

        let child = spawn_whisper_server(app, model_path)?;
        // Confirm health BEFORE caching the child. If the process spawned but never
        // becomes healthy (bad/half-downloaded model, port already bound, OOM during
        // load), kill it and DON'T cache — otherwise `is_started()` would be true
        // forever and every later partial would stall on health polls against a dead
        // process with no recovery short of an app restart.
        match self.wait_healthy().await {
            Ok(()) => {
                // OnceCell::set fails only if already set, which the guard precludes.
                let _ = self.child.set(child);
                Ok(())
            }
            Err(e) => {
                let _ = child.kill();
                Err(e)
            }
        }
    }

    /// Poll `GET /health` with the [`health_backoff_schedule`] until it returns a
    /// success status, or `Err` after the schedule is exhausted. Probes FIRST (so a
    /// warm/already-healthy server returns with no added latency), sleeping only
    /// BETWEEN retries. Each probe has a short timeout so a wedged socket can't hang.
    async fn wait_healthy(&self) -> Result<(), String> {
        let client = http_client(std::time::Duration::from_secs(2));
        let url = format!("{}/health", server_base(WHISPER_PORT));
        let schedule = health_backoff_schedule(HEALTH_MAX_ATTEMPTS, HEALTH_BASE_MS);
        for (i, delay) in schedule.iter().enumerate() {
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    return Ok(());
                }
            }
            if i + 1 < schedule.len() {
                tokio::time::sleep(std::time::Duration::from_millis(*delay)).await;
            }
        }
        Err(format!(
            "whisper-server did not become healthy after {} attempts",
            schedule.len()
        ))
    }
}

/// A reqwest client with a hard request timeout, so a wedged `whisper-server`
/// (slow load, pathological audio) can never block partials forever — the caller
/// turns a timeout into an `Err` and the frontend degrades to no partial. Falls
/// back to a default client if the builder fails (it won't with just a timeout).
///
/// DUPLICATED (intentionally, a tiny local mirror) rather than sharing
/// `polish.rs`'s `http_client` to keep this module self-contained and avoid
/// touching the concurrently-edited polish.rs.
fn http_client(timeout: std::time::Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Spawn the `whisper-server` sidecar with the tiny model on the fixed localhost
/// port. Uses the Tauri shell plugin's sidecar API (`app.shell().sidecar(...)`),
/// which resolves the bundled `whisper-server-<target-triple>` binary. Returns the
/// child handle (kept alive in [`WhisperServer`]); the OS reaps it on app exit.
fn spawn_whisper_server(
    app: &AppHandle,
    model_path: &str,
) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    use tauri_plugin_shell::ShellExt;

    let args = whisper_server_args(model_path, WHISPER_PORT);
    let (_rx, child) = app
        .shell()
        .sidecar("whisper-server")
        .map_err(|e| format!("resolve whisper-server sidecar: {e}"))?
        .args(args)
        .spawn()
        .map_err(|e| format!("spawn whisper-server: {e}"))?;
    Ok(child)
}

/// Resolve the bundled TINY model path the partials server loads. MIRRORS
/// `lib.rs::voice_bundled_model_path`: prefer the staged Tauri resource at
/// `<resource_dir>/models/<tiny filename>`, falling back (debug only) to the
/// source-tree copy at `<CARGO_MANIFEST_DIR>/models/<tiny filename>` so dictation
/// works under `tauri dev`/`cargo run` where bundle resources aren't staged.
/// `Err` when neither is present (caller degrades to no partials).
fn bundled_tiny_model_path(app: &AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let path = resource_dir
        .join("models")
        .join(models::tiny_spec().filename);
    if path.is_file() {
        return Ok(path.to_string_lossy().into_owned());
    }
    #[cfg(debug_assertions)]
    {
        let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("models")
            .join(models::tiny_spec().filename);
        if dev_path.is_file() {
            return Ok(dev_path.to_string_lossy().into_owned());
        }
    }
    Err(format!(
        "bundled tiny model not present: {}",
        models::tiny_spec().filename
    ))
}

// --- Tauri command ----------------------------------------------------------

/// LIVE PARTIAL transcription of a PCM slice via the persistent whisper-server.
/// STATELESS — transcribes exactly the slice it is given (the frontend owns all
/// retention/concatenation state; see `src/lib/voice/pipeline.ts`).
///
/// Pipeline: VAD-gate the PCM (no speech → "", so a silent window never makes
/// whisper hallucinate) → trim leading/trailing silence → resample to a 16 kHz
/// mono WAV in memory → ensure the server is up+healthy on the bundled tiny model
/// (lazy start) → POST the WAV to `/inference` as multipart form
/// (`file`, `response_format=json`, `temperature=0`) → [`parse_inference_response`].
///
/// Best-effort, NEVER panics: ANY failure (no model, server won't start, HTTP
/// error, bad response) returns `Err`, which the frontend swallows (the overlay
/// simply doesn't update). It only fully RUNS with the provisioned binary + tiny
/// model + real audio (MANUAL); it COMPILES regardless.
#[tauri::command]
pub async fn voice_transcribe_partial(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<WhisperServer>>,
    pcm: Vec<f32>,
    sample_rate: u32,
) -> Result<String, String> {
    // Anti-hallucination: a window with no detected speech → empty, no inference.
    if !crate::vad::has_speech(&pcm, crate::transcribe::VAD_FRAME_LEN, crate::transcribe::VAD_THRESHOLD)
    {
        return Ok(String::new());
    }

    // Trim leading/trailing silence to the spoken extent, then encode a 16 kHz WAV.
    let trimmed = crate::vad::trim_silence(
        &pcm,
        crate::transcribe::VAD_FRAME_LEN,
        crate::transcribe::VAD_THRESHOLD,
    );
    let wav = crate::transcribe::pcm_f32_to_wav_16k_mono(trimmed, sample_rate);

    // Ensure the partials server is up+healthy on the bundled tiny model.
    let model_path = bundled_tiny_model_path(&app)?;
    state.ensure_running(&app, &model_path).await?;

    // POST the WAV bytes to /inference as multipart/form-data. A hard timeout means
    // a wedged server can't block the tick loop forever — on timeout this Errs and
    // the frontend degrades to no partial.
    let url = format!("{}/inference", server_base(WHISPER_PORT));
    let part = reqwest::multipart::Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("build wav part: {e}"))?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("response_format", "json")
        .text("temperature", "0");

    let client = http_client(std::time::Duration::from_secs(10));
    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("POST {url}: {e}"))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| format!("POST {url} status: {e}"))?;
    let json = resp
        .text()
        .await
        .map_err(|e| format!("read {url} body: {e}"))?;
    parse_inference_response(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_server_args_has_model_host_port_and_no_timestamps() {
        let args = whisper_server_args("/m/tiny.bin", 8766);
        assert_eq!(
            args,
            vec![
                "-m",
                "/m/tiny.bin",
                "--host",
                "127.0.0.1",
                "--port",
                "8766",
                "-nt",
            ]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn parse_inference_response_accepts_top_level_text() {
        let json = r#"{ "text": "  Hello world.  " }"#;
        assert_eq!(parse_inference_response(json).unwrap(), "Hello world.");
    }

    #[test]
    fn parse_inference_response_accepts_transcription_segments() {
        let json = r#"{ "transcription": [ { "text": " Hello" }, { "text": " world." } ] }"#;
        assert_eq!(parse_inference_response(json).unwrap(), "Hello world.");
    }

    #[test]
    fn parse_inference_response_strips_nonspeech_annotations() {
        // A noise-only window must yield "" (not "[BLANK_AUDIO]").
        assert_eq!(
            parse_inference_response(r#"{ "text": " [BLANK_AUDIO]" }"#).unwrap(),
            ""
        );
        assert_eq!(
            parse_inference_response(r#"{ "transcription": [ { "text": "(wind)" } ] }"#).unwrap(),
            ""
        );
    }

    #[test]
    fn parse_inference_response_empty_text_is_empty_string() {
        assert_eq!(parse_inference_response(r#"{ "text": "" }"#).unwrap(), "");
        assert_eq!(
            parse_inference_response(r#"{ "transcription": [] }"#).unwrap(),
            ""
        );
    }

    #[test]
    fn parse_inference_response_malformed_is_error() {
        assert!(parse_inference_response("not json at all").is_err());
    }

    #[test]
    fn parse_inference_response_unknown_shape_is_error() {
        // Well-formed JSON but neither recognized field → Err.
        assert!(parse_inference_response(r#"{ "foo": 1 }"#).is_err());
    }
}
