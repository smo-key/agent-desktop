//! On-device speech-to-text via the bundled `whisper.cpp` `whisper-cli` sidecar.
//!
//! This module is split into PURE, fully-unit-tested helpers (the argument
//! builder, the JSON output parser, and the 16 kHz-mono WAV encoder) and the
//! thin Tauri command surface that wires them to the actual sidecar process and
//! the live audio channel. The command bodies can only RUN end-to-end with the
//! provisioned `whisper-cli` binary + a model on disk + real mic audio, so the
//! live path is MANUAL (see tasks.md 9.1); the helpers and the typed contracts
//! are exercised headlessly here.
//!
//! ## Audio transport decision
//! The FINAL pass ([`voice_transcribe_final`]) uses a **per-utterance temp WAV**:
//! the frontend hands us the full captured utterance as `f32` PCM at the capture
//! sample rate, we resample to whisper's required 16 kHz mono, write a real WAV
//! to a temp file, and run `whisper-cli -f <wav>` once. A single final pass has a
//! generous latency budget (it runs after the user stops speaking), so the
//! simplicity and zero-decode-dependency of a temp WAV beats any streaming-stdin
//! complexity. whisper.cpp needs 16 kHz mono PCM and we never want to depend on a
//! container decoder, hence the raw-`f32` → WAV path (the TS capture slice adds a
//! raw-PCM tap so no Opus/WebM decode is ever required).
//!
//! Live PARTIALS ([`voice_transcribe_stream`]) mirror the same idea over a small
//! model and a rolling window (see that fn's docs); the real-time loop needs the
//! binary and is stubbed/MANUAL for now.

use std::io::Write;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;

use crate::vad;

/// whisper.cpp's required input sample rate (16 kHz), mono.
const WHISPER_SAMPLE_RATE: u32 = 16_000;

/// Frame length (in samples at the capture rate) used for VAD gating of the
/// final utterance. 0 would be invalid; this is a coarse ~ a few-ms frame which
/// is plenty to detect any speech presence. The actual size is not latency
/// sensitive here (we gate once, before the final pass).
const VAD_FRAME_LEN: usize = 512;

/// Default VAD energy threshold for normalized mic input. Above this RMS a frame
/// is considered speech. Kept LOW (≈ -48 dBFS) so quiet speech / soft laptop mics
/// still pass — its only job is to discard true silence/empty buffers (just above
/// a typical noise floor). whisper's own silence annotations are stripped
/// downstream, so a slightly permissive gate is safe.
const VAD_THRESHOLD: f32 = 0.004;

// --- Pure helper: argument builder ------------------------------------------

/// Build the `whisper-cli` argument vector for a one-shot transcription that
/// emits JSON. Flags (verified against whisper.cpp's `whisper-cli`):
///   `-m <model>`   model weights path
///   `-f <wav>`     input WAV (16 kHz mono PCM)
///   `-oj`          output JSON (written to `<wav>.json` by whisper-cli)
///   `-of <stem>`   output file STEM, so the JSON lands at `<stem>.json`
///                  deterministically (we derive `<stem>` from the wav path by
///                  stripping the `.wav` extension; the caller reads that file)
///   `-nt`          no per-token timestamps (we only want the text)
///   `-l <lang>`    language (only when provided; omitted ⇒ whisper auto-detects)
///
/// Returning the explicit `-of` stem makes the JSON output path deterministic
/// for the command to read back, rather than relying on whisper-cli's implicit
/// `<input>.json` naming (which differs subtly across versions).
pub fn whisper_args(model_path: &str, wav_path: &str, language: Option<&str>) -> Vec<String> {
    let stem = wav_path.strip_suffix(".wav").unwrap_or(wav_path).to_string();
    let mut args = vec![
        "-m".to_string(),
        model_path.to_string(),
        "-f".to_string(),
        wav_path.to_string(),
        "-oj".to_string(),
        "-of".to_string(),
        stem,
        "-nt".to_string(),
    ];
    if let Some(lang) = language {
        args.push("-l".to_string());
        args.push(lang.to_string());
    }
    args
}

/// The deterministic JSON output path that [`whisper_args`] directs whisper-cli
/// to write (the `<stem>.json` produced by `-of <stem> -oj`).
pub fn whisper_json_path(wav_path: &str) -> String {
    let stem = wav_path.strip_suffix(".wav").unwrap_or(wav_path);
    format!("{stem}.json")
}

// --- Pure helper: JSON output parser ----------------------------------------

/// Extract the concatenated transcript text from whisper.cpp's JSON output.
///
/// whisper-cli's JSON has the shape:
/// ```json
/// { "transcription": [ { "text": " Hello" }, { "text": " world." } ], ... }
/// ```
/// We join every segment's `text`, then collapse surrounding whitespace and
/// trim. A document with no `transcription` array, or an empty one, yields an
/// empty string (not an error — silence/no-speech legitimately produces no text).
/// Malformed JSON is an `Err`.
pub fn parse_whisper_json(stdout: &str) -> Result<String, String> {
    let v: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|e| format!("parse whisper json: {e}"))?;
    let Some(segments) = v.get("transcription").and_then(|t| t.as_array()) else {
        return Ok(String::new());
    };
    let joined: String = segments
        .iter()
        .filter_map(|seg| seg.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");
    // Strip non-speech annotations + collapse whitespace.
    Ok(strip_nonspeech(&joined))
}

/// Remove whisper.cpp's NON-SPEECH annotations — the bracketed/parenthesized
/// tokens it emits for silence/noise/music (e.g. `[BLANK_AUDIO]`, `[MUSIC]`,
/// `[INAUDIBLE]`, `(wind blowing)`, `(laughs)`) — then collapse whitespace. A
/// noise-only utterance thus yields an EMPTY string rather than an annotation that
/// the polish LLM would treat as "no transcript provided". Real speech is
/// unaffected (whisper does not bracket ordinary words).
pub fn strip_nonspeech(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut sq = 0i32; // [...] depth
    let mut rd = 0i32; // (...) depth
    for c in text.chars() {
        match c {
            '[' => sq += 1,
            ']' => sq = (sq - 1).max(0),
            '(' => rd += 1,
            ')' => rd = (rd - 1).max(0),
            _ if sq == 0 && rd == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// --- Pure helper: WAV encoder -----------------------------------------------

/// Resample `samples` (mono `f32` in `[-1, 1]` at `src_rate`) to 16 kHz mono and
/// encode a 16-bit little-endian PCM WAV (canonical 44-byte RIFF header). A
/// simple linear resample is used — adequate for STT input. Samples are clamped
/// to `[-1, 1]` before quantization. When `src_rate == 16000` the samples pass
/// through the resampler unchanged (modulo clamping).
pub fn pcm_f32_to_wav_16k_mono(samples: &[f32], src_rate: u32) -> Vec<u8> {
    let resampled = resample_linear(samples, src_rate, WHISPER_SAMPLE_RATE);
    encode_wav_16bit_mono(&resampled, WHISPER_SAMPLE_RATE)
}

/// Linear-interpolation resample of a mono `f32` signal from `src_rate` to
/// `dst_rate`. Returns the input unchanged when the rates match or the input is
/// empty / a rate is zero (defensive). Output length is
/// `round(len * dst_rate / src_rate)`.
fn resample_linear(samples: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if samples.is_empty() || src_rate == 0 || dst_rate == 0 || src_rate == dst_rate {
        return samples.to_vec();
    }
    let ratio = dst_rate as f64 / src_rate as f64;
    let out_len = ((samples.len() as f64) * ratio).round() as usize;
    if out_len == 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(out_len);
    let step = src_rate as f64 / dst_rate as f64; // input samples per output sample
    for i in 0..out_len {
        let pos = i as f64 * step;
        let idx = pos.floor() as usize;
        let frac = pos - idx as f64;
        let a = samples.get(idx).copied().unwrap_or(0.0);
        let b = samples.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac as f32);
    }
    out
}

/// Encode mono `f32` samples as a 16-bit PCM WAV byte vector (canonical RIFF
/// header + `data` chunk). Samples are clamped to `[-1, 1]` then scaled to
/// `i16`.
fn encode_wav_16bit_mono(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * num_channels as u32 * bits_per_sample as u32 / 8;
    let block_align = num_channels * bits_per_sample / 8;
    let data_len = (samples.len() * 2) as u32;
    let riff_len = 36 + data_len; // 4 ("WAVE") + (8+16 fmt) + (8 + data_len)

    let mut buf = Vec::with_capacity(44 + data_len as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&riff_len.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt subchunk (PCM, 16 bytes).
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes()); // audio format = 1 (PCM)
    buf.extend_from_slice(&num_channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data subchunk.
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        // Symmetric scale; i16::MAX avoids overflow at +1.0.
        let v = (clamped * i16::MAX as f32) as i16;
        buf.extend_from_slice(&v.to_le_bytes());
    }
    buf
}

// --- Live-partials channel contract -----------------------------------------

/// Event streamed to the frontend over a `Channel<TranscribeEvent>` during live
/// dictation. Mirrors `PtyEvent`'s internally-tagged serialization so the JS
/// side switches on the `event` field:
///   `{ "event": "partial", "text": "..." }`  — a rolling, may-change partial
///   `{ "event": "final",   "text": "..." }`  — the committed final transcript
///   `{ "event": "error",   "message": "..." }`
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum TranscribeEvent {
    /// A low-latency partial from the small model over the current rolling
    /// window. Supersedes the previous partial (the UI replaces, not appends).
    Partial { text: String },
    /// The committed final transcript for the utterance.
    Final { text: String },
    /// A non-fatal error string for the UI to surface.
    Error { message: String },
}

// --- Tauri commands ---------------------------------------------------------

/// Final, high-quality pass over a full captured utterance (large-v3-turbo when
/// the caller's `model_path` is the accurate tier — tier→path selection lives in
/// the model-management slice; here we just run whatever path we're given).
///
/// Pipeline: VAD-gate the PCM (return "" if there is no speech, so silence yields
/// no transcript and whisper is never asked to hallucinate) → resample to 16 kHz
/// mono WAV in a temp file → run `whisper-cli` with [`whisper_args`] → read the
/// deterministic JSON output → [`parse_whisper_json`] → return the text. The temp
/// WAV + JSON are cleaned up best-effort.
///
/// End-of-speech in the UI (VAD stop / the panel's stop control) is what triggers
/// this command. It only RUNS with a real binary + model on disk — that live path
/// is MANUAL (tasks.md 9.1) — but it COMPILES and its pure helpers are tested.
#[tauri::command]
pub async fn voice_transcribe_final(
    app: AppHandle,
    pcm: Vec<f32>,
    sample_rate: u32,
    model_path: String,
    language: Option<String>,
) -> Result<String, String> {
    // Anti-hallucination: if the utterance has no detected speech, return empty
    // without invoking whisper (spec: "Silence produces no text").
    if !vad::has_speech(&pcm, VAD_FRAME_LEN, VAD_THRESHOLD) {
        return Ok(String::new());
    }

    // Trim leading/trailing silence to the spoken extent before encoding.
    let trimmed = vad::trim_silence(&pcm, VAD_FRAME_LEN, VAD_THRESHOLD);
    let wav = pcm_f32_to_wav_16k_mono(trimmed, sample_rate);

    // Per-utterance temp WAV (audio-transport decision; see module docs).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let wav_path = std::env::temp_dir().join(format!("agentdesk-voice-{}-{nanos}.wav", std::process::id()));
    let wav_path_str = wav_path.to_string_lossy().into_owned();
    {
        let mut f =
            std::fs::File::create(&wav_path).map_err(|e| format!("create temp wav: {e}"))?;
        f.write_all(&wav).map_err(|e| format!("write temp wav: {e}"))?;
    }

    let args = whisper_args(&model_path, &wav_path_str, language.as_deref());
    let json_path = whisper_json_path(&wav_path_str);

    let result = run_whisper(&app, &args, &json_path).await;

    // Best-effort cleanup of the temp WAV + JSON regardless of outcome.
    let _ = std::fs::remove_file(&wav_path);
    let _ = std::fs::remove_file(&json_path);

    result
}

/// Run the whisper-cli sidecar with `args` and parse the JSON it writes to
/// `json_path`. Factored out so [`voice_transcribe_final`] reads as a pipeline.
///
/// Uses the Tauri shell plugin's sidecar API (`app.shell().sidecar(...)`), which
/// resolves the bundled `whisper-cli-<target-triple>` binary. This only succeeds
/// with the provisioned binary present (MANUAL to run); it compiles regardless.
async fn run_whisper(app: &AppHandle, args: &[String], json_path: &str) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;

    let output = app
        .shell()
        .sidecar("whisper-cli")
        .map_err(|e| format!("resolve whisper-cli sidecar: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("run whisper-cli: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "whisper-cli exited {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    // Prefer the deterministic JSON file. Fall back to whisper-cli's stdout text
    // (with `-nt` it prints the plain transcript) when the JSON is absent or
    // unreadable — some builds/flag versions of whisper-cli write it differently.
    // Only if BOTH are empty do we surface an error, with provisioning guidance
    // (the most common cause is the placeholder sidecar / missing real binary).
    match std::fs::read_to_string(json_path) {
        Ok(json) => parse_whisper_json(&json),
        Err(_) => {
            let text = clean_transcript_text(&String::from_utf8_lossy(&output.stdout));
            if !text.is_empty() {
                return Ok(text);
            }
            Err(format!(
                "whisper-cli produced no JSON ({json_path}) and no stdout text — \
                 ensure the real whisper-cli sidecar and a model are provisioned \
                 (run scripts/fetch-whisper.sh and scripts/fetch-models.sh). stderr: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }
}

/// Collapse a raw text blob (e.g. whisper-cli's plain stdout) into a single-spaced
/// trimmed transcript, stripping non-speech annotations. Used as the stdout
/// fallback when the JSON output is absent.
pub fn clean_transcript_text(s: &str) -> String {
    strip_nonspeech(s)
}

/// Live partial transcription over a sliding window (scaffolding + typed channel
/// contract). Mirrors `pty_spawn`'s `Channel` usage: the frontend supplies an
/// `on_event` channel and we send [`TranscribeEvent`]s over it.
///
/// SLIDING-WINDOW APPROACH (documented; the real-time loop is MANUAL — it needs
/// the binary + live audio): while recording, accumulate `f32` PCM; every ~0.5s
/// re-transcribe a rolling window (e.g. the last few seconds, VAD-trimmed) with
/// the SMALL/tiny model and emit a `Partial { text }` that supersedes the prior
/// one. On end-of-speech the UI calls [`voice_transcribe_final`] for the
/// high-quality `Final`. Silent windows are skipped via VAD so partials never
/// hallucinate text from silence.
///
/// For now this validates the channel is live (sends nothing) and returns Ok —
/// the deliverable for this slice is the typed contract + registration + that it
/// compiles. The driving loop lands with the live binary (tasks.md 9.1).
#[tauri::command]
pub fn voice_transcribe_stream(
    _app: AppHandle,
    on_event: Channel<TranscribeEvent>,
    _model_path: String,
) -> Result<(), String> {
    // Keep `on_event` referenced so the contract is exercised at the type level;
    // the real-time re-transcription loop is intentionally stubbed (MANUAL).
    let _ = &on_event;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u32_le(buf: &[u8], at: usize) -> u32 {
        u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]])
    }
    fn u16_le(buf: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([buf[at], buf[at + 1]])
    }

    #[test]
    fn clean_transcript_text_collapses_whitespace_and_trims() {
        assert_eq!(
            clean_transcript_text("  Hello   world,\n this is\ta test.  "),
            "Hello world, this is a test."
        );
        assert_eq!(clean_transcript_text("   \n\t  "), "");
    }

    #[test]
    fn strip_nonspeech_drops_whisper_annotations() {
        // Noise-only utterances → empty (so polish never sees "[BLANK_AUDIO]").
        assert_eq!(strip_nonspeech("[BLANK_AUDIO]"), "");
        assert_eq!(strip_nonspeech("[ Silence ]"), "");
        assert_eq!(strip_nonspeech("(wind blowing)"), "");
        // Real speech with an embedded annotation keeps the words.
        assert_eq!(
            strip_nonspeech("Hello [MUSIC] world (laughs) again"),
            "Hello world again"
        );
        // parse_whisper_json applies it too.
        let json = r#"{"transcription":[{"text":" [BLANK_AUDIO]"}]}"#;
        assert_eq!(parse_whisper_json(json).unwrap(), "");
    }

    #[test]
    fn whisper_args_builds_json_flags_without_language() {
        let args = whisper_args("/m/tiny.bin", "/tmp/u.wav", None);
        assert_eq!(
            args,
            vec![
                "-m", "/m/tiny.bin", "-f", "/tmp/u.wav", "-oj", "-of", "/tmp/u", "-nt"
            ]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn whisper_args_appends_language_when_provided() {
        let args = whisper_args("/m/large.bin", "/tmp/u.wav", Some("en"));
        assert_eq!(
            args,
            vec![
                "-m", "/m/large.bin", "-f", "/tmp/u.wav", "-oj", "-of", "/tmp/u", "-nt", "-l",
                "en"
            ]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>()
        );
    }

    #[test]
    fn whisper_json_path_swaps_wav_for_json() {
        assert_eq!(whisper_json_path("/tmp/u.wav"), "/tmp/u.json");
        // No `.wav` suffix → just append `.json`.
        assert_eq!(whisper_json_path("/tmp/u"), "/tmp/u.json");
    }

    #[test]
    fn parse_whisper_json_concatenates_segment_text() {
        // Representative whisper.cpp `-oj` output (abbreviated).
        let sample = r#"
        {
          "systeminfo": "…",
          "model": { "type": "tiny" },
          "transcription": [
            { "timestamps": {"from":"00:00:00,000","to":"00:00:01,000"}, "text": " Hello" },
            { "timestamps": {"from":"00:00:01,000","to":"00:00:02,000"}, "text": " world." }
          ]
        }"#;
        assert_eq!(parse_whisper_json(sample).unwrap(), "Hello world.");
    }

    #[test]
    fn parse_whisper_json_empty_transcription_is_empty_string() {
        assert_eq!(
            parse_whisper_json(r#"{ "transcription": [] }"#).unwrap(),
            ""
        );
        // Missing key → empty, not an error (no-speech is legitimate).
        assert_eq!(parse_whisper_json(r#"{ "model": {} }"#).unwrap(), "");
    }

    #[test]
    fn parse_whisper_json_malformed_is_error() {
        assert!(parse_whisper_json("not json at all").is_err());
    }

    #[test]
    fn wav_header_has_correct_magic_and_sample_rate() {
        let wav = pcm_f32_to_wav_16k_mono(&[0.0f32; 16_000], 16_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        // Sample-rate field is at byte offset 24 in the fmt subchunk.
        assert_eq!(u32_le(&wav, 24), 16_000);
        // Mono, 16-bit.
        assert_eq!(u16_le(&wav, 22), 1, "num_channels");
        assert_eq!(u16_le(&wav, 34), 16, "bits_per_sample");
    }

    #[test]
    fn wav_byte_length_matches_samples_at_16k() {
        // No resample (already 16k): N samples → 44 header + 2*N data bytes.
        let n = 800usize;
        let wav = pcm_f32_to_wav_16k_mono(&vec![0.1f32; n], 16_000);
        assert_eq!(wav.len(), 44 + 2 * n);
        // The `data` chunk length field equals 2*N.
        assert_eq!(u32_le(&wav, 40), (2 * n) as u32);
        // The RIFF length field equals 36 + data_len.
        assert_eq!(u32_le(&wav, 4), 36 + (2 * n) as u32);
    }

    #[test]
    fn wav_resamples_48k_to_16k_to_a_third_of_the_length() {
        // 4800 samples @ 48k → ~1600 samples @ 16k (±1).
        let wav = pcm_f32_to_wav_16k_mono(&vec![0.0f32; 4800], 48_000);
        let data_len = u32_le(&wav, 40) as usize; // bytes
        let out_samples = data_len / 2;
        assert!(
            (out_samples as i64 - 1600).abs() <= 1,
            "expected ~1600 samples, got {out_samples}"
        );
    }

    #[test]
    fn wav_clamps_out_of_range_samples() {
        // +2.0 and -2.0 must clamp to +/- full scale, not wrap.
        let wav = pcm_f32_to_wav_16k_mono(&[2.0, -2.0], 16_000);
        let s0 = i16::from_le_bytes([wav[44], wav[45]]);
        let s1 = i16::from_le_bytes([wav[46], wav[47]]);
        assert_eq!(s0, i16::MAX);
        assert_eq!(s1, -i16::MAX);
    }

    #[test]
    fn transcribe_event_serializes_tagged() {
        let p = serde_json::to_value(TranscribeEvent::Partial {
            text: "hi".into(),
        })
        .unwrap();
        assert_eq!(p["event"], "partial");
        assert_eq!(p["text"], "hi");
        let f = serde_json::to_value(TranscribeEvent::Final {
            text: "done".into(),
        })
        .unwrap();
        assert_eq!(f["event"], "final");
        let e = serde_json::to_value(TranscribeEvent::Error {
            message: "boom".into(),
        })
        .unwrap();
        assert_eq!(e["event"], "error");
        assert_eq!(e["message"], "boom");
    }
}
