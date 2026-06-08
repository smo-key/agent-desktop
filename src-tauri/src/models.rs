//! On-device model REGISTRY + download planning for voice input.
//!
//! This module is the PURE, fully-unit-tested core of the model-management slice
//! (tasks.md 5.1–5.3). It knows nothing about HTTP or the filesystem beyond path
//! arithmetic and a presence check: it answers "given the selected tier + polish
//! setting, and the set of model files already on disk, which models must be
//! downloaded?". The actual download (streaming HTTP → atomic rename) and the
//! Tauri command surface live in `transcribe.rs`'s sibling download code / `lib.rs`
//! — those can only RUN with network + disk space (MANUAL); the planning here is
//! exercised headlessly.
//!
//! ## Model storage layout
//! Downloaded models live under `<app_data_dir>/models/<filename>`. The TINY model
//! is BUNDLED as a Tauri resource (see `tauri.conf.json` `bundle.resources` and
//! `lib.rs`'s `bundled_tiny_model_path`) so first-run / offline transcription works
//! with zero downloads — it is therefore NEVER returned by [`models_needed`].

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

/// The transcription tier the user selected (mirrors the `voice.modelTier`
/// setting: `fast` → small final model, `accurate` → large-v3-turbo final model).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Fast,
    Accurate,
}

impl Tier {
    /// Parse the frontend's `modelTier` string. Anything other than `"fast"`
    /// maps to `Accurate` (the app default), so an unexpected/missing value is
    /// safe rather than an error.
    pub fn from_str(s: &str) -> Tier {
        match s {
            "fast" => Tier::Fast,
            _ => Tier::Accurate,
        }
    }
}

/// What ROLE a model plays in the pipeline. Used to select which entries a given
/// (tier, polish) combination needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    /// Tiny whisper model — live partials + offline fallback. BUNDLED.
    WhisperLive,
    /// Small whisper model — the `fast` tier's final pass.
    WhisperFinalFast,
    /// large-v3-turbo whisper model — the `accurate` tier's final pass.
    WhisperFinalAccurate,
    /// The transcript-polish LLM (GGUF). Needed only when polish is enabled.
    Polish,
}

/// A single downloadable (or bundled) model: its stable id, role, on-disk
/// filename, source URL, and an approximate size in bytes (used only for a
/// pre-download estimate / the progress `total` fallback — the real total comes
/// from the HTTP `Content-Length` at download time).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub kind: ModelKind,
    pub filename: &'static str,
    pub url: &'static str,
    pub approx_bytes: u64,
}

// --- The registry -----------------------------------------------------------
//
// whisper.cpp GGML model weights are published under the Hugging Face repo
// `ggerganov/whisper.cpp`; the canonical download URL form is
// `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>`.

/// Tiny whisper model — BUNDLED as a resource (never in [`models_needed`]). Listed
/// here so provisioning (`scripts/fetch-models.sh`) and the bundled-path resolver
/// share one source of truth for the filename. ~75 MB.
pub const TINY: ModelSpec = ModelSpec {
    id: "whisper-tiny",
    kind: ModelKind::WhisperLive,
    filename: "ggml-tiny.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    approx_bytes: 77_700_000,
};

/// Small whisper model — the `fast` tier's final pass. ~488 MB.
pub const SMALL: ModelSpec = ModelSpec {
    id: "whisper-small",
    kind: ModelKind::WhisperFinalFast,
    filename: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    approx_bytes: 487_600_000,
};

/// large-v3-turbo (q5_0 quantized) — the `accurate` tier's final pass. ~574 MB.
pub const LARGE_V3_TURBO: ModelSpec = ModelSpec {
    id: "whisper-large-v3-turbo",
    kind: ModelKind::WhisperFinalAccurate,
    filename: "ggml-large-v3-turbo-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
    approx_bytes: 574_000_000,
};

/// Transcript-polish LLM (GGUF): Qwen3 1.7B, the `Q8_0` quant — the only GGUF
/// published in the official `Qwen/Qwen3-1.7B-GGUF` repo (verified to resolve;
/// ~1.83 GB). A smaller Q4_K_M is not in the official repo, so we use Q8_0 to
/// keep the URL authoritative. Used by `llama-server` for the optional polish
/// pass when `polish` is enabled.
pub const POLISH: ModelSpec = ModelSpec {
    id: "polish-qwen3-1.7b",
    kind: ModelKind::Polish,
    filename: "Qwen3-1.7B-Q8_0.gguf",
    url: "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf",
    approx_bytes: 1_834_426_016,
};

/// The bundled tiny model spec (its filename is the source of truth for the
/// resource path + provisioning script).
pub fn tiny_spec() -> &'static ModelSpec {
    &TINY
}

/// The final-pass whisper model for `tier` (`fast` → small, `accurate` → turbo).
pub fn final_model_for(tier: Tier) -> &'static ModelSpec {
    match tier {
        Tier::Fast => &SMALL,
        Tier::Accurate => &LARGE_V3_TURBO,
    }
}

/// Compute the models that MUST be downloaded for the given selection, EXCLUDING
/// any whose filename is already in `present` (already on disk) and ALWAYS
/// excluding the bundled tiny model.
///
/// - The final-pass whisper model is selected by `tier`
///   (`fast` → [`SMALL`], `accurate` → [`LARGE_V3_TURBO`]).
/// - When `polish` is true, [`POLISH`] is also required.
pub fn models_needed(tier: Tier, polish: bool, present: &HashSet<String>) -> Vec<&'static ModelSpec> {
    let mut candidates: Vec<&'static ModelSpec> = vec![final_model_for(tier)];
    if polish {
        candidates.push(&POLISH);
    }
    candidates
        .into_iter()
        .filter(|spec| !present.contains(spec.filename))
        .collect()
}

/// The absolute on-disk path a downloaded model lives at:
/// `<app_data_dir>/models/<filename>`.
pub fn model_path(app_data_dir: &Path, spec: &ModelSpec) -> PathBuf {
    app_data_dir.join("models").join(spec.filename)
}

/// Whether the model file already exists under `<app_data_dir>/models/`.
pub fn is_present(app_data_dir: &Path, spec: &ModelSpec) -> bool {
    model_path(app_data_dir, spec).is_file()
}

/// Scan `<app_data_dir>/models/` and return the set of filenames present there.
/// A missing dir yields an empty set (nothing downloaded yet). This is the only
/// IO in this module; [`models_needed`] consumes the set it returns.
pub fn present_filenames(app_data_dir: &Path) -> HashSet<String> {
    let dir = app_data_dir.join("models");
    let mut set = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    set.insert(name.to_string());
                }
            }
        }
    }
    set
}

/// PURE: from the filenames present under `<app_data_dir>/models/`, the subset that
/// is DELETABLE downloaded model data — every downloadable registry model that is
/// present ([`SMALL`], [`LARGE_V3_TURBO`], [`POLISH`]; NOT the bundled [`TINY`]),
/// plus any leftover `*.part` temp file from an interrupted download. The bundled
/// tiny model ships as a resource and never lives under `models/`, so it is never
/// returned here — "delete downloaded models" must not touch it. Extracted so the
/// selection is unit-testable apart from the filesystem.
pub fn deletable_filenames(present: &HashSet<String>) -> Vec<String> {
    let downloadable: [&str; 3] = [SMALL.filename, LARGE_V3_TURBO.filename, POLISH.filename];
    present
        .iter()
        .filter(|name| downloadable.contains(&name.as_str()) || name.ends_with(".part"))
        .cloned()
        .collect()
}

// --- Tauri command surface --------------------------------------------------

/// Progress event streamed to the frontend over a `Channel<DownloadEvent>` during
/// download-on-first-run. Internally-tagged (mirrors `TranscribeEvent` /
/// `PtyEvent`) so the JS side switches on the `event` field:
///   `{ "event": "start",    "id": "...", "total": N }`
///   `{ "event": "progress", "id": "...", "received": N, "total": N }`
///   `{ "event": "done",     "id": "..." }`
///   `{ "event": "error",    "id": "...", "message": "..." }`
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum DownloadEvent {
    /// A model download is starting; `total` is the `Content-Length` (or the
    /// registry's `approx_bytes` when the server omits it).
    Start { id: String, total: u64 },
    /// Cumulative bytes received so far for `id`.
    Progress { id: String, received: u64, total: u64 },
    /// `id` finished downloading and was atomically moved into place.
    Done { id: String },
    /// `id` failed; `message` is a human-readable reason. The command continues
    /// to the next model so one failure doesn't abandon the others.
    Error { id: String, message: String },
}

/// Readiness report for the UI: whether all models required by the current
/// selection are present, and the filenames of any that are missing.
#[derive(Debug, Clone, Serialize)]
pub struct ModelsStatus {
    pub ready: bool,
    pub missing: Vec<String>,
}

/// Report which models the current (tier, polish) selection needs that are not
/// yet on disk. `ready` is true iff nothing is missing. The bundled tiny model is
/// never counted (it ships with the app), so a fresh install with the default
/// selection reports the final-pass (+ polish) model(s) as missing.
///
/// The present-scan is IO; the readiness decision reuses the pure
/// [`models_needed`].
#[tauri::command]
pub fn voice_models_status(
    app: AppHandle,
    tier: String,
    polish: bool,
) -> Result<ModelsStatus, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let present = present_filenames(&base);
    let missing: Vec<String> = models_needed(Tier::from_str(&tier), polish, &present)
        .into_iter()
        .map(|s| s.filename.to_string())
        .collect();
    Ok(ModelsStatus {
        ready: missing.is_empty(),
        missing,
    })
}

/// Total size in bytes of the DELETABLE downloaded model files present under
/// `<app_data_dir>/models/` (the whisper tier models + the polish LLM, plus any
/// `.part` leftovers — never the bundled tiny model). Zero when nothing is
/// downloaded or the dir is missing. Lets the Settings UI show how much space a
/// delete would reclaim and disable the control when there is nothing to remove.
#[tauri::command]
pub fn voice_models_disk_usage(app: AppHandle) -> Result<u64, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let models_dir = base.join("models");
    let mut total = 0u64;
    for name in deletable_filenames(&present_filenames(&base)) {
        if let Ok(meta) = std::fs::metadata(models_dir.join(&name)) {
            total += meta.len();
        }
    }
    Ok(total)
}

/// Delete every DELETABLE downloaded model file (and `.part` leftover) under
/// `<app_data_dir>/models/`, returning the total bytes freed. Best-effort and
/// idempotent: a missing dir/file is a no-op (mirrors `delete_specialist`), and a
/// file that can't be removed is skipped rather than aborting the rest, so one
/// stuck file never strands the others. The bundled tiny model is never under
/// `models/`, so it is never removed; the next voice use re-downloads on demand.
#[tauri::command]
pub fn voice_delete_models(app: AppHandle) -> Result<u64, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let models_dir = base.join("models");
    let mut freed = 0u64;
    for name in deletable_filenames(&present_filenames(&base)) {
        let path = models_dir.join(&name);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        // Best-effort: count bytes only on a successful unlink; skip on any error
        // (including already-gone) so a single failure can't abort the sweep.
        if std::fs::remove_file(&path).is_ok() {
            freed += size;
        }
    }
    Ok(freed)
}

/// How often (in bytes received since the last emit) the download loop emits a
/// `Progress` event, so a multi-hundred-MB download doesn't flood the channel
/// with one event per network chunk. ~2 MB ≈ a smooth bar without spam.
const PROGRESS_EMIT_INTERVAL: u64 = 2 * 1024 * 1024;

/// Download every model the current selection needs that isn't already on disk,
/// streaming progress to the frontend over `on_event`.
///
/// For each needed model: emit [`DownloadEvent::Start`], stream the HTTP body in
/// chunks (summing bytes, emitting throttled [`DownloadEvent::Progress`]) to a
/// sibling `<filename>.part` temp file, then ATOMICALLY rename it into place and
/// emit [`DownloadEvent::Done`]. A failure on one model emits
/// [`DownloadEvent::Error`] for it and CONTINUES to the next (best-effort,
/// never panics) — the caller learns the final readiness via
/// [`voice_models_status`].
///
/// This only fully RUNS with network + disk space (MANUAL — multi-GB downloads
/// cannot run in CI); it COMPILES and its pure helpers ([`percent`], the
/// planning) are tested.
#[tauri::command]
pub async fn voice_download_models(
    app: AppHandle,
    tier: String,
    polish: bool,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let models_dir = base.join("models");
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("create models dir {models_dir:?}: {e}"))?;

    let present = present_filenames(&base);
    let needed = models_needed(Tier::from_str(&tier), polish, &present);

    // Force HTTP/1.1. reqwest offers h2 via ALPN by default, but some corporate
    // TLS-inspecting proxies (e.g. Netskope) mishandle the h2 connection and tear
    // it down mid-handshake — surfacing as rustls "peer closed connection without
    // sending TLS close_notify (unexpected EOF)" and failing every download. h1
    // negotiates cleanly through the same proxy. Falls back to a default client if
    // the builder ever fails (it doesn't, with these options).
    let client = reqwest::Client::builder()
        .http1_only()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    for spec in needed {
        if let Err(message) = download_one(&client, spec, &models_dir, &on_event).await {
            // Best-effort: surface this model's failure and keep going.
            let _ = on_event.send(DownloadEvent::Error {
                id: spec.id.to_string(),
                message,
            });
        }
    }
    Ok(())
}

/// Stream a single model to `<models_dir>/<filename>.part`, emitting progress over
/// `on_event`, then atomically rename it to its final name. Returns `Err(msg)` on
/// any HTTP/IO failure (the caller turns it into a `DownloadEvent::Error`).
async fn download_one(
    client: &reqwest::Client,
    spec: &ModelSpec,
    models_dir: &Path,
    on_event: &Channel<DownloadEvent>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let resp = client
        .get(spec.url)
        .send()
        .await
        .map_err(|e| format!("GET {}: {e}", spec.url))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| format!("GET {} status: {e}", spec.url))?;

    // Prefer the server's Content-Length; fall back to the registry estimate so
    // the bar still moves when the server omits it.
    let total = resp.content_length().unwrap_or(spec.approx_bytes);
    let _ = on_event.send(DownloadEvent::Start {
        id: spec.id.to_string(),
        total,
    });

    let final_path = models_dir.join(spec.filename);
    let part_path = models_dir.join(format!("{}.part", spec.filename));
    let mut file =
        std::fs::File::create(&part_path).map_err(|e| format!("create {part_path:?}: {e}"))?;

    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream {}: {e}", spec.url))?;
        file.write_all(&chunk)
            .map_err(|e| format!("write {part_path:?}: {e}"))?;
        received += chunk.len() as u64;
        if received - last_emit >= PROGRESS_EMIT_INTERVAL {
            last_emit = received;
            let _ = on_event.send(DownloadEvent::Progress {
                id: spec.id.to_string(),
                received,
                total: total.max(received),
            });
        }
    }
    file.flush().map_err(|e| format!("flush {part_path:?}: {e}"))?;
    drop(file);

    // A final progress at 100% then atomic move into place.
    let _ = on_event.send(DownloadEvent::Progress {
        id: spec.id.to_string(),
        received,
        total: received,
    });
    std::fs::rename(&part_path, &final_path)
        .map_err(|e| format!("rename {part_path:?} -> {final_path:?}: {e}"))?;
    let _ = on_event.send(DownloadEvent::Done {
        id: spec.id.to_string(),
    });
    Ok(())
}

// --- Pure progress math -----------------------------------------------------

/// Integer download percent (0..=100) for `received`/`total`. A zero/unknown
/// `total` yields 0 (we can't know the fraction yet). `received >= total` clamps
/// to 100. Extracted so the throttling/aggregation logic is unit-testable apart
/// from the HTTP loop.
pub fn percent(received: u64, total: u64) -> u8 {
    if total == 0 {
        return 0;
    }
    let pct = (received.min(total) as u128 * 100) / total as u128;
    pct as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn present(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn models_needed_fast_tier_returns_small() {
        let needed = models_needed(Tier::Fast, false, &HashSet::new());
        assert_eq!(needed.len(), 1);
        assert_eq!(needed[0].filename, "ggml-small.bin");
        assert_eq!(needed[0].kind, ModelKind::WhisperFinalFast);
    }

    #[test]
    fn models_needed_accurate_tier_returns_turbo() {
        let needed = models_needed(Tier::Accurate, false, &HashSet::new());
        assert_eq!(needed.len(), 1);
        assert_eq!(needed[0].filename, "ggml-large-v3-turbo-q5_0.bin");
        assert_eq!(needed[0].kind, ModelKind::WhisperFinalAccurate);
    }

    #[test]
    fn models_needed_includes_polish_when_enabled() {
        let needed = models_needed(Tier::Fast, true, &HashSet::new());
        let kinds: Vec<ModelKind> = needed.iter().map(|s| s.kind).collect();
        assert!(kinds.contains(&ModelKind::WhisperFinalFast));
        assert!(kinds.contains(&ModelKind::Polish));
        assert_eq!(needed.len(), 2);
    }

    #[test]
    fn models_needed_omits_polish_when_disabled() {
        let needed = models_needed(Tier::Accurate, false, &HashSet::new());
        assert!(!needed.iter().any(|s| s.kind == ModelKind::Polish));
    }

    #[test]
    fn models_needed_excludes_present_filenames() {
        // accurate + polish, but turbo already on disk → only polish remains.
        let needed = models_needed(
            Tier::Accurate,
            true,
            &present(&["ggml-large-v3-turbo-q5_0.bin"]),
        );
        assert_eq!(needed.len(), 1);
        assert_eq!(needed[0].kind, ModelKind::Polish);

        // Everything present → nothing needed.
        let none = models_needed(
            Tier::Accurate,
            true,
            &present(&["ggml-large-v3-turbo-q5_0.bin", "Qwen3-1.7B-Q8_0.gguf"]),
        );
        assert!(none.is_empty());
    }

    /// Aligns with the spec scenario "Bundled model usable immediately": the
    /// bundled tiny model is never planned for download regardless of selection.
    #[test]
    fn bundled_model_usable_immediately() {
        for tier in [Tier::Fast, Tier::Accurate] {
            for polish in [false, true] {
                let needed = models_needed(tier, polish, &HashSet::new());
                assert!(
                    !needed.iter().any(|s| s.filename == "ggml-tiny.bin"),
                    "tiny must never be in models_needed (it is bundled)"
                );
                assert!(!needed.iter().any(|s| s.kind == ModelKind::WhisperLive));
            }
        }
    }

    /// Aligns with the spec scenario "Download larger models with progress": the
    /// right larger whisper model is planned per tier, and the planning excludes
    /// what's already stored for reuse.
    #[test]
    fn download_larger_models_with_progress() {
        // fast → small, accurate → turbo.
        assert_eq!(
            models_needed(Tier::Fast, false, &HashSet::new())[0].filename,
            "ggml-small.bin"
        );
        assert_eq!(
            models_needed(Tier::Accurate, false, &HashSet::new())[0].filename,
            "ggml-large-v3-turbo-q5_0.bin"
        );
        // Stored-for-reuse: once present, not re-planned.
        assert!(models_needed(Tier::Fast, false, &present(&["ggml-small.bin"])).is_empty());
    }

    #[test]
    fn deletable_filenames_selects_downloaded_models_and_parts() {
        let on_disk = present(&[
            "ggml-small.bin",
            "ggml-large-v3-turbo-q5_0.bin",
            "Qwen3-1.7B-Q8_0.gguf",
            "ggml-large-v3-turbo-q5_0.bin.part", // interrupted download leftover
            "ggml-tiny.bin",                     // bundled — must NEVER be deletable
            "notes.txt",                         // unknown — left alone
        ]);
        let got: HashSet<String> = deletable_filenames(&on_disk).into_iter().collect();
        let want = present(&[
            "ggml-small.bin",
            "ggml-large-v3-turbo-q5_0.bin",
            "Qwen3-1.7B-Q8_0.gguf",
            "ggml-large-v3-turbo-q5_0.bin.part",
        ]);
        assert_eq!(got, want);
        assert!(
            !got.contains("ggml-tiny.bin"),
            "the bundled tiny model is never a downloaded model and must be preserved"
        );
        assert!(!got.contains("notes.txt"), "unknown files must be left alone");
    }

    #[test]
    fn deletable_filenames_empty_when_nothing_present() {
        assert!(deletable_filenames(&HashSet::new()).is_empty());
    }

    #[test]
    fn tier_from_str_defaults_to_accurate() {
        assert_eq!(Tier::from_str("fast"), Tier::Fast);
        assert_eq!(Tier::from_str("accurate"), Tier::Accurate);
        assert_eq!(Tier::from_str("nonsense"), Tier::Accurate);
        assert_eq!(Tier::from_str(""), Tier::Accurate);
    }

    #[test]
    fn model_path_is_under_models_subdir() {
        let base = Path::new("/data/app");
        let p = model_path(base, &SMALL);
        assert_eq!(p, PathBuf::from("/data/app/models/ggml-small.bin"));
    }

    #[test]
    fn is_present_reflects_disk_state() {
        let dir = std::env::temp_dir().join(format!(
            "agentdesk-models-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let models = dir.join("models");
        std::fs::create_dir_all(&models).unwrap();
        assert!(!is_present(&dir, &SMALL));
        std::fs::write(models.join(SMALL.filename), b"x").unwrap();
        assert!(is_present(&dir, &SMALL));

        // present_filenames picks it up; models_needed then excludes it.
        let present = present_filenames(&dir);
        assert!(present.contains("ggml-small.bin"));
        assert!(models_needed(Tier::Fast, false, &present).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn present_filenames_missing_dir_is_empty() {
        let dir = std::env::temp_dir().join(format!(
            "agentdesk-models-absent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(present_filenames(&dir).is_empty());
    }

    #[test]
    fn percent_handles_zero_partial_and_full() {
        assert_eq!(percent(0, 0), 0); // unknown total
        assert_eq!(percent(50, 0), 0);
        assert_eq!(percent(0, 100), 0);
        assert_eq!(percent(50, 100), 50);
        assert_eq!(percent(100, 100), 100);
        assert_eq!(percent(150, 100), 100); // clamps
    }

    #[test]
    fn download_event_serializes_tagged() {
        let s = serde_json::to_value(DownloadEvent::Start {
            id: "whisper-small".into(),
            total: 100,
        })
        .unwrap();
        assert_eq!(s["event"], "start");
        assert_eq!(s["id"], "whisper-small");
        assert_eq!(s["total"], 100);

        let p = serde_json::to_value(DownloadEvent::Progress {
            id: "x".into(),
            received: 5,
            total: 10,
        })
        .unwrap();
        assert_eq!(p["event"], "progress");
        assert_eq!(p["received"], 5);

        let d = serde_json::to_value(DownloadEvent::Done { id: "x".into() }).unwrap();
        assert_eq!(d["event"], "done");

        let e = serde_json::to_value(DownloadEvent::Error {
            id: "x".into(),
            message: "boom".into(),
        })
        .unwrap();
        assert_eq!(e["event"], "error");
        assert_eq!(e["message"], "boom");
    }

    #[test]
    fn registry_urls_are_huggingface_resolve_links() {
        for spec in [&TINY, &SMALL, &LARGE_V3_TURBO, &POLISH] {
            assert!(
                spec.url.starts_with("https://huggingface.co/") && spec.url.contains("/resolve/"),
                "{} url should be an HF resolve link: {}",
                spec.id,
                spec.url
            );
            assert!(spec.approx_bytes > 0, "{} needs an approx size", spec.id);
        }
    }
}
