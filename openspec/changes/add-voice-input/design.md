## Context

Agent Desktop is a Tauri app: a SvelteKit + Svelte 5 + TypeScript frontend over a
Rust backend. The agent interaction model is terminal-first — there is no text
input box; users type into an xterm terminal, and programmatic text reaches the
agent via `TerminalHandle.send(text)` which writes verbatim bytes to the PTY
(`src/lib/layout/terminals.ts`; see `src/lib/launcher/initialInput.ts` for the
"verbatim, once" guarantees). Frontend↔backend communication is Tauri `invoke`
commands plus `emit`/`listen` events and `Channel<T>` for streaming (see
`pty_spawn` in `src-tauri/src/lib.rs`). Settings persist to a JSON file via
`settings_load`/`settings_save`; the UI is `SettingsModal.svelte` with a reactive
store (`src/lib/settings/openWith.svelte.ts`). Overlays use a fixed-position
Svelte component toggled by a runes store (`launcherStore.svelte.ts`).

There is currently **no** microphone capture, no native key monitoring, and no
bundled native binaries (PTY uses the `portable-pty` crate). This change
introduces all three. Target platform for v1 is **Apple Silicon macOS only**.

Research basis: a Wispr-Flow-style feature is a two-stage pipeline — streaming
STT for the live overlay + final text, then a small LLM "polish" pass. Whisper is
not natively streaming, so live partials come from re-transcribing a rolling
window; the clean final comes from one pass over the whole utterance.

## Goals / Non-Goals

**Goals:**
- Fast, accurate, fully on-device dictation: live overlay latency on the order of
  a few hundred ms; final clean text within ~1s of the user stopping.
- Activation by mic button and a solo tap of the **right** Command key.
- Clean, agent-ready output via an optional (default-on) local LLM polish pass.
- Verbatim insertion into the focused agent's terminal with **no** auto-submit.
- No transcripts or audio ever leave the device.

**Non-Goals:**
- Fn-key activation gesture (deferred to a follow-up change).
- System-wide / cross-application dictation (only the focused agent terminal).
- Non-macOS platforms and Intel Macs.
- Any cloud STT/LLM fallback.
- Speaker diarization, multi-language tuning, or custom vocabulary (v1 uses
  Whisper's defaults).

## Decisions

### D1 — STT engine: `whisper.cpp` sidecar binary
Ship a prebuilt `whisper.cpp` arm64 binary as a Tauri sidecar
(`tauri.conf.json` `externalBin`), spawned from Rust. Metal acceleration is
automatic; it is MIT-licensed and self-contained.
*Alternatives:* Parakeet-MLX (higher accuracy, native streaming) — rejected for
v1 because it needs a Python/MLX runtime and is CC-BY/English-only; Apple
SpeechAnalyzer (free, native streaming) — rejected as the baseline because it is
macOS 26+ only and needs a Swift bridge, but noted as a future progressive
enhancement; node/native-addon bindings — rejected due to ABI rebuild churn.

### D2 — Dual-model live + final
A small model (`tiny`/`small`) runs on a sliding audio window to produce **live
partials** for the overlay; on end-of-speech, **large-v3-turbo** runs once over
the full utterance for the high-quality **final** transcript that feeds polish.
Partials are explicitly provisional (may rewrite as more context arrives) and are
visually distinct from the committed final.
*Alternative:* single turbo model sliding-window for both — rejected because turbo
partials are laggier; the small model gives the snappy "what I'm saying" feel.

### D3 — VAD silence gating
Use voice-activity detection (whisper.cpp built-in / Silero) to detect utterance
boundaries and to discard silent/empty/low-confidence segments. This both ends
the utterance (triggering the final pass) and prevents Whisper's well-known
tendency to hallucinate phantom text during silence.

### D4 — Polish: separate small local LLM, toggleable
A second stage sends the final transcript to a small instruction-tuned LLM
(Qwen3 1.7B Q4_K_M — the `models::POLISH` registry entry) running as a bundled
local server subprocess. **Shippable baseline (implemented):** llama.cpp's
`llama-server` provisioned as a Tauri sidecar (mirrors the whisper-cli sidecar;
no Python/MLX dependency to ship), serving an OpenAI-compatible
`POST /v1/chat/completions` on `127.0.0.1`, lazy-started with a `/health`
backoff check (see `src-tauri/src/polish.rs`). **Future optimization:** an MLX
server is preferred on Apple Silicon for speed, but is deferred — `llama-server`
is the shippable v1. The tight system prompt:
remove fillers/false-starts/repetitions, fix punctuation/capitalization,
structure spoken lists, output clean prompt text, **add no new content**. A
settings toggle (default on) bypasses this stage and inserts the raw transcript.
*Alternative:* a single audio-LLM doing transcription + cleanup — rejected as not
a fast/reliable shippable local option in 2026. *Why separate model:* each stage
does what it's best at; matches Wispr Flow's STT→LLM architecture.

### D5 — Activation: native macOS NSEvent monitor for a solo right-Cmd tap
The webview does not see the left/right distinction of modifier keys or
standalone modifier taps reliably, and Tauri/`globalShortcut` cannot express a
bare right-Command tap. A small Rust native module (`voice_activation.rs`)
installs GLOBAL + LOCAL `NSEvent` monitors over `flagsChanged | keyDown`, isolates
the RIGHT-Command key (keyCode 54), and detects a **solo tap** — right-Command
pressed and released with no other key/modifier in between — via a pure,
unit-tested `SoloTapDetector`. On a solo tap it emits a `voice://activate` Tauri
event the frontend listens for to open the panel. A right-Command *shortcut*
(e.g. right-⌘+C) disarms the tap (the other key marks "not solo"), so it never
triggers voice. The on-screen footer mic button opens the panel directly. The
**Fn** gesture is deferred.
*Decision history:* originally a double-tap of right-Command; changed to a single
solo tap per user request (a bare tap is faster, and solo-tap detection keeps it
from clobbering right-Command shortcuts).
*Alternative:* "any right-Command press" — rejected because it would hijack every
right-Command shortcut; the solo-tap discipline is what makes a single tap safe.

### D6 — Mic capture in the webview
Audio is captured with `getUserMedia` in the webview and streamed to the Rust STT
sidecar (via a command that accepts audio chunks, or a tmp WAV per
window/utterance). macOS permission is handled with `NSMicrophoneUsageDescription`
in Info.plist and the `com.apple.security.device.audio-input` entitlement; the app
must be signed + hardened-runtime + notarized or the mic silently fails. The UI
detects denied permission and guides the user to System Settings.

### D7 — Insertion: verbatim into focused agent terminal, no auto-submit
The finished text is written through the existing `TerminalHandle.send(text)`
path to the **currently focused** agent terminal, **without** a trailing carriage
return, so the user reviews and presses enter. Reuse the verbatim guarantees from
`initialInput.ts` — never wrap, synthesize, or slash-command the text. If no agent
terminal is focused, the panel surfaces a clear "no target" state rather than
sending anywhere unexpected.

### D8 — Model packaging: bundle tiny, download the rest
Bundle only the tiny whisper model (instant first use / offline fallback).
Download large-v3-turbo (~1.1GB q5) and the polish LLM (~0.7–1.5GB) on first run
with a progress UI; store under app data (not the installer, not git). A
settings "model tier" lets advanced users pick what to fetch.

## Risks / Trade-offs

- **Whisper hallucinates on silence** → VAD gating (D3) + drop empty/low-confidence
  segments; never insert text from a window with no detected speech.
- **Native NSEvent monitor is the riskiest piece** (unsafe FFI, focus/permission
  edge cases, could interfere with other right-Cmd uses) → keep it isolated and
  small; the mic button is a fully functional fallback path; require a deliberate
  double-tap window to avoid false triggers; fail closed (no monitor → button
  still works).
- **Microphone permission silently fails without correct signing/entitlements**
  → explicit permission-status check + user guidance UI; document the
  Info.plist/entitlement/notarization requirements in tasks.
- **Bundle size / first-run download friction** (~2.5–3.5GB total) → bundled tiny
  model gives immediate usability; download with clear progress and resumability;
  models cached in app data.
- **Latency budget** (live overlay + final + polish) → small model for partials,
  turbo only once at end, small/fast polish LLM via MLX; show the panel state so
  the user perceives progress even if polish adds a beat.
- **Polish LLM could alter meaning** (over-editing, hallucinating content) →
  constrained system prompt ("add no new content"); toggle to disable; final text
  is reviewable before the user presses enter (no auto-submit).
- **Two bundled runtimes (whisper sidecar + LLM server)** increase packaging
  complexity → both spawned/managed from Rust with health checks; lifecycle tied
  to app; degrade gracefully (polish off) if the LLM server is unavailable.

## Open Questions

- Exact polish model pick (Qwen3 1.7B vs Llama 3.2 3B) and LLM runtime (MLX
  server vs llama.cpp server) — to be settled during build by measuring latency
  and quality on real dictation; both fit the design.
- Audio transport to the sidecar (streamed chunks vs per-window temp WAV files)
  — pick whichever meets the latency budget most simply during implementation.
- Whether to expose the small "live" model size as a setting or fix it at `small`.
