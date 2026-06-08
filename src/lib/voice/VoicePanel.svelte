<script lang="ts">
  // The voice-input PANEL — a fixed, bottom-center FLOATING (non-modal) panel that
  // reflects the shared `voiceStore` phase and live transcript. Mounted
  // unconditionally in +page.svelte and gates on `voiceStore.open` (mirroring the
  // Launcher/HelpModal/SettingsModal pattern). Unlike the launcher this is NOT a
  // dimming modal: it floats over the app and does NOT capture clicks outside it —
  // there is no scrim, so the app behind stays interactive while dictating and a
  // click outside neither closes nor cancels the panel. Dismissal is explicit only:
  // the × cancel button, Escape (window-level capture, even over a focused TUI), and
  // the ✓ confirm. Single instance is enforced by the store's show() no-op.
  //
  // This slice renders state only; capture + transcription land in later slices and
  // drive the store via setState/setPartial/setFinal/setError.

  import { voiceStore } from './voiceStore.svelte';
  import { DictationPipeline, setActivePipeline } from './pipeline';
  import { classifyMicError, MIC_DENIED_GUIDANCE, micGuidanceFor } from './permission';
  import { ensureModels } from './models';
  import { modelDownload } from './modelStore.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import Icon from '../icons/Icon.svelte';
  import { tooltip } from '../ui/tooltip';

  // Model readiness: when the panel opens, ensure the models the current
  // `modelTier` + `polish` selection needs are present, downloading the missing
  // ones with progress reflected into `modelDownload`. This runs in PARALLEL with
  // mic permission/capture below (no need to gate the mic on the download); the UI
  // shows a "Preparing models… NN%" state from the store while `active`. The
  // bundled tiny model means transcription can still proceed offline even before
  // larger models land — readiness is surfaced, not enforced, by this slice.
  $effect(() => {
    if (!voiceStore.open) return;
    void ensureModels(voice.prefs.modelTier, voice.prefs.polish);
  });

  // The full DICTATION PIPELINE is owned HERE (this feature owns VoicePanel), not
  // in +page.svelte. A single $effect watches `voiceStore.open`: on open it builds
  // a `DictationPipeline` and runs the permission-gated capture→record→(live
  // partials) start sequence; on teardown it DISCARDS (stops capture + releases the
  // OS mic, no transcription). Finalization is an EXPLICIT user action — see the
  // "Stop & insert" button below — so closing/teardown never silently transcribes.
  let pipeline = $state<DictationPipeline | null>(null);

  $effect(() => {
    if (!voiceStore.open) return;

    const p = new DictationPipeline();
    let cancelled = false;
    pipeline = p;
    // Register as the live pipeline so the global activation handler can finalize
    // it on a second right-⌘ tap (tap-to-stop).
    setActivePipeline(p);

    voiceStore.setState('requesting');
    p.start()
      .then(() => {
        if (cancelled) {
          // Panel closed mid-request: don't leave the mic on.
          p.cancel();
        }
        // start() already set 'recording' on success.
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const outcome = classifyMicError(err);
        if (outcome === 'denied') {
          voiceStore.setState('denied');
          voiceStore.setError(MIC_DENIED_GUIDANCE);
        } else {
          // setError forces state to 'error'.
          voiceStore.setError(micGuidanceFor('error'));
        }
        // Do NOT proceed to record.
      });

    // Cleanup on close / teardown: DISCARD — stop capture, release the mic, no
    // insert. The explicit "Stop & insert" control finalizes BEFORE close, so by
    // the time this runs the pipeline is already finished (cancel() is a no-op).
    return () => {
      cancelled = true;
      p.cancel();
      pipeline = null;
      setActivePipeline(null);
    };
  });

  // EXPLICIT finalize: stop capture, run the final whisper pass, polish per
  // settings, insert verbatim into the focused terminal (no auto-submit), then
  // close. The user reviews/edits the text IN THE TERMINAL, not in this panel.
  function stopAndInsert() {
    void pipeline?.stopAndInsert();
  }

  // DISCARD: × / Escape. Stops capture + releases the mic without transcribing or
  // inserting (the $effect cleanup's cancel() does the work). We call close() which
  // tears the panel down and triggers that cleanup. (Clicking outside the panel is
  // deliberately NOT a discard — there is no scrim.)
  function discard() {
    voiceStore.close();
  }

  // The status line for the current phase.
  const status = $derived.by(() => {
    switch (voiceStore.state) {
      case 'requesting':
        return 'Requesting microphone…';
      case 'denied':
        return 'Microphone access denied';
      case 'recording':
        return 'Listening…';
      case 'transcribing':
        return 'Transcribing…';
      case 'error':
        return voiceStore.error ?? 'Something went wrong';
      case 'idle':
      default:
        return 'Speak to dictate';
    }
  });

  // Window-level Esc cancels the panel while it's open — and it must win even when
  // a TUI (xterm) is focused. xterm handles keydown on its own textarea and stops
  // propagation, so a bubble-phase `svelte:window` listener never sees Escape. We
  // therefore register a CAPTURE-phase listener on window: capture runs top-down
  // (window → … → target) BEFORE xterm's handler, so we intercept Escape first,
  // swallow it (preventDefault + stopImmediatePropagation so the TUI never sees
  // it), and discard. Only active while the panel is open, so Escape passes through
  // to the app/TUI normally otherwise.
  $effect(() => {
    if (!voiceStore.open) return;
    const onEscCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      discard();
    };
    window.addEventListener('keydown', onEscCapture, true);
    return () => window.removeEventListener('keydown', onEscCapture, true);
  });

  // Show the primary confirm (✓) control only while recording — not while
  // requesting the mic, denied, errored, or already transcribing.
  const canStopAndInsert = $derived(voiceStore.state === 'recording');

  // Live waveform: a symmetric, centered 5-bar display. Each bar's height is the
  // overall mic LEVEL shaped by a centered profile (tallest in the middle) and an
  // independent per-bar oscillation, so all five bars dance while you speak (rather
  // than only the center reacting). While recording, sample the level each
  // animation frame; the effect only loops while recording.
  const BAR_SHAPE = [0.55, 0.8, 1, 0.8, 0.55]; // centered profile (5 bars)
  let bars = $state<number[]>(new Array(5).fill(0));

  $effect(() => {
    if (voiceStore.state !== 'recording') {
      bars = new Array(5).fill(0);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (ts: number) => {
      if (!t0) t0 = ts;
      const t = (ts - t0) / 1000;
      const level = pipeline?.getLevel() ?? 0;
      bars = BAR_SHAPE.map((shape, i) => {
        // Independent oscillation per bar (different phase) so they don't move in
        // lockstep; amplitude scales with the live mic level.
        const osc = 0.5 + 0.5 * Math.sin(t * 7 + i * 1.25);
        return level * shape * (0.4 + 0.6 * osc);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // Map a normalized level (0–1) to a bar height in px (small idle floor → lively).
  function barHeight(level: number): number {
    return Math.round(4 + Math.min(1, level) * 22);
  }

  // The text shown in the recording / processing rows: the live partial, falling
  // back to the committed final (e.g. while finalizing) or a gentle placeholder.
  const overlayText = $derived(voiceStore.partial || voiceStore.finalText);
</script>


{#if !voiceStore.open && voice.prefs.enabled}
  <!-- Footer launcher: a small overlay panel centered in the footer. It's the
       on-screen entry point to dictation — clicking it opens the full voice panel,
       which occupies the same bottom-center spot (so this hides while open). The
       right-⌘ tap gesture opens the same panel. -->
  <button
    type="button"
    class="voice-fab"
    aria-label="Voice input"
    use:tooltip={'Voice input (tap right ⌘)'}
    onclick={() => voiceStore.show()}
  >
    <Icon name="mic" size={15} />
  </button>
{/if}

{#if voiceStore.open}
  <!-- The floating panel. No scrim sits behind it: a click outside the panel does
       NOT close or cancel dictation, and the app behind stays interactive. -->
  <div
    class="voice-panel"
    role="dialog"
    aria-label="Voice input"
    aria-live="polite"
    tabindex="-1"
  >
    {#if modelDownload.active && voiceStore.state !== 'denied' && voiceStore.state !== 'error'}
      <!-- Models downloading on first use: a thin determinate strip shown ABOVE the
           recording controls. The bundled tiny model still lets dictation work, so
           the waveform + confirm stay available below — this is informative, not a
           block. -->
      <div class="preparing">
        <div class="prep-row">
          <span class="prep-label">Preparing models…</span>
          <span class="prep-pct">{modelDownload.percent}%</span>
        </div>
        <div class="prep-track">
          <div class="prep-fill" style:width={`${modelDownload.percent}%`}></div>
        </div>
        {#if modelDownload.error}
          <p class="prep-err">{modelDownload.error}</p>
        {/if}
      </div>
    {/if}

    {#if voiceStore.state === 'denied' || voiceStore.state === 'error'}
      <!-- Denied / error state: prominent guidance; recording does NOT proceed. -->
      <div class="guidance" class:denied={voiceStore.state === 'denied'}>
        <p class="guidance-msg">{voiceStore.error ?? status}</p>
        {#if voiceStore.state === 'denied'}
          <p class="guidance-hint">
            Open System Settings → Privacy &amp; Security → Microphone, allow
            agent-desktop, then reopen voice input.
          </p>
        {/if}
      </div>
    {:else if voiceStore.state === 'transcribing'}
      <!-- PROCESSING: the same captured text, shimmering blue until finalized. -->
      <div class="proc">
        <span class="proc-text">{overlayText || 'Transcribing…'}</span>
      </div>
    {:else}
      <!-- RECORDING (or requesting mic): live waveform + transcript + confirm (✓). -->
      <div class="rec">
        <div class="wave" aria-hidden="true">
          {#each bars as b, i (i)}
            <span class="bar" style:height={`${barHeight(b)}px`}></span>
          {/each}
        </div>
        <span class="rec-text" class:dim={!overlayText}>{overlayText || status}</span>
        <button
          class="confirm"
          aria-label="Insert dictation"
          use:tooltip={'Insert (tap right ⌘)'}
          onclick={stopAndInsert}
          disabled={!canStopAndInsert}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </button>
        <button class="x" aria-label="Cancel voice input" use:tooltip={'Cancel (Esc)'} onclick={() => discard()}>×</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Footer launcher: a small, pill-shaped overlay panel centered in the footer,
     shown only while the full panel is closed. Sits below the open panel's z-index
     (it's hidden when the panel is open) but above the app chrome. */
  .voice-fab {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1500;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 36px;
    padding: 0;
    border-radius: var(--r-full);
    border: 1px solid var(--line-default);
    background: var(--space-800);
    box-shadow: var(--shadow-lg);
    color: var(--fg-2);
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease,
      transform 0.15s ease;
  }
  .voice-fab:hover {
    color: var(--fg-1);
    background: var(--space-700);
    transform: translateX(-50%) translateY(-1px);
  }

  .voice-panel {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    width: min(520px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-lg);
    color: var(--fg-1);
    font-family: var(--font-sans);
    outline: none;
  }

  /* RECORDING row: live waveform · transcript · confirm (✓) · cancel (×). */
  .rec {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* 7 rounded bars driven by the mic level. */
  .wave {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 28px;
    flex: none;
  }
  .bar {
    width: 3px;
    min-height: 4px;
    border-radius: var(--r-full);
    background: #fff;
    transition: height 0.08s linear;
  }

  .rec-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--fg-1);
    max-height: 30vh;
    overflow-y: auto;
    word-break: break-word;
  }
  .rec-text.dim {
    color: var(--fg-3);
  }

  /* Primary confirm (✓): a round accent button distinct from the × cancel. */
  .confirm {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: none;
    border: none;
    border-radius: var(--r-full);
    background: var(--accent, #3b82f6);
    color: #fff;
    cursor: pointer;
    transition: filter 0.15s ease;
  }
  .confirm:hover {
    filter: brightness(1.1);
  }
  .confirm:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .x {
    width: 26px;
    height: 26px;
    flex: none;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-3);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-1);
  }

  /* PROCESSING: the captured text shimmering blue until the final result lands. */
  .proc {
    font-size: 14px;
    line-height: 1.5;
    max-height: 30vh;
    overflow-y: auto;
    word-break: break-word;
  }
  .proc-text {
    background: linear-gradient(
      90deg,
      var(--fg-3) 0%,
      #3b82f6 25%,
      #60a5fa 50%,
      #3b82f6 75%,
      var(--fg-3) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: voice-shimmer 1.4s linear infinite;
  }

  @keyframes voice-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  /* Denied / error guidance: a distinct, prominent block (not the transcript
     view). The denied variant gets a subtle warning tint so it reads as
     actionable, not as in-progress dictation. */
  .guidance {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--r-lg);
    border: 1px solid var(--line-default);
    background: var(--space-650);
  }
  .guidance.denied {
    border-color: rgba(229, 72, 77, 0.45);
    background: rgba(229, 72, 77, 0.08);
  }
  .guidance-msg {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--fg-1);
  }
  .guidance-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg-3);
  }

  /* "Preparing models…" download progress: a determinate bar fed by the
     modelDownload store's overall percent. */
  .preparing {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .prep-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 13px;
  }
  .prep-label {
    color: var(--fg-2);
    font-weight: 500;
  }
  .prep-pct {
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .prep-track {
    height: 6px;
    border-radius: var(--r-full);
    background: var(--space-650);
    overflow: hidden;
  }
  .prep-fill {
    height: 100%;
    border-radius: var(--r-full);
    background: var(--fg-2);
    transition: width 0.2s ease;
  }
  .prep-err {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: #ff8a8d;
  }
</style>
