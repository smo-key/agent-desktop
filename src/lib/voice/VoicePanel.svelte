<script lang="ts">
  // The voice-input PANEL — a fixed, bottom-center FLOATING (non-modal) panel that
  // reflects the shared `voiceStore` phase and live transcript. Mounted
  // unconditionally in +page.svelte and gates on `voiceStore.open` (mirroring the
  // Launcher/HelpModal/SettingsModal pattern). Unlike the launcher this is NOT a
  // dimming modal: it floats over the app with a TRANSPARENT click-outside layer
  // behind it. Dismissal: the × stop button, Escape (window-level, since nothing is
  // focused by default), and a click on the transparent layer — all call
  // voiceStore.close(). Single instance is enforced by the store's show() no-op.
  //
  // This slice renders state only; capture + transcription land in later slices and
  // drive the store via setState/setPartial/setFinal/setError.

  import { voiceStore } from './voiceStore.svelte';
  import { DictationPipeline } from './pipeline';
  import { classifyMicError, MIC_DENIED_GUIDANCE, micGuidanceFor } from './permission';
  import { ensureModels } from './models';
  import { modelDownload } from './modelStore.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import Icon from '../icons/Icon.svelte';

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
    };
  });

  // EXPLICIT finalize: stop capture, run the final whisper pass, polish per
  // settings, insert verbatim into the focused terminal (no auto-submit), then
  // close. The user reviews/edits the text IN THE TERMINAL, not in this panel.
  function stopAndInsert() {
    void pipeline?.stopAndInsert();
  }

  // DISCARD: × / Escape / click-outside. Stops capture + releases the mic without
  // transcribing or inserting (the $effect cleanup's cancel() does the work). We
  // call close() which tears the panel down and triggers that cleanup.
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

  // Window-level Esc: there's no focused dialog by default, so close on Escape
  // whenever the panel is open.
  function onWindowKeydown(e: KeyboardEvent) {
    if (voiceStore.open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      discard();
    }
  }

  // Show the primary "Stop & insert" control only while there is an utterance to
  // finalize (recording) — not while requesting the mic, denied, errored, or
  // already transcribing.
  const canStopAndInsert = $derived(voiceStore.state === 'recording');
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if voiceStore.open}
  <!-- Transparent click-outside layer (no dimming) behind the floating panel; a
       <button> so it's natively keyboard/focus accessible. Esc is also handled at
       the window level above. -->
  <button
    type="button"
    class="voice-scrim"
    aria-label="Dismiss voice input"
    onclick={() => discard()}
  ></button>

  <!-- The floating panel. It's a sibling of the scrim (not nested), so a click on
       it never reaches the scrim — no stopPropagation needed. -->
  <div
    class="voice-panel"
    role="dialog"
    aria-label="Voice input"
    aria-live="polite"
    tabindex="-1"
  >
    <div class="row">
      <span
        class="indicator"
        class:rec={voiceStore.state === 'recording'}
        class:err={voiceStore.state === 'error' || voiceStore.state === 'denied'}
      >
        <Icon name="mic" size={15} />
      </span>
      <span class="status" class:err={voiceStore.state === 'error' || voiceStore.state === 'denied'}>{status}</span>
      {#if canStopAndInsert}
        <!-- PRIMARY action: finalize the utterance (final pass → polish → verbatim
             insert into the focused terminal) then close. The user reviews the text
             in the TERMINAL, not here. -->
        <button class="stop-insert" onclick={stopAndInsert}>Stop &amp; insert</button>
      {/if}
      <!-- CANCEL: discard the utterance (stop mic, no transcription, no insert). -->
      <button class="x" aria-label="Cancel voice input" onclick={() => discard()}>×</button>
    </div>

    {#if modelDownload.active && voiceStore.state !== 'denied' && voiceStore.state !== 'error'}
      <!-- Models are downloading on first use: show a determinate "Preparing
           models…" bar (NN% from the store) over the listening view. The bundled
           tiny model still lets dictation work, so this is informative, not a hard
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
    {:else if voiceStore.state === 'denied' || voiceStore.state === 'error'}
      <!-- Denied / error state: render the guidance prominently, distinct from the
           normal listening view. Recording does NOT proceed in this state. -->
      <div class="guidance" class:denied={voiceStore.state === 'denied'}>
        <p class="guidance-msg">{voiceStore.error ?? status}</p>
        {#if voiceStore.state === 'denied'}
          <p class="guidance-hint">
            Open System Settings → Privacy &amp; Security → Microphone, allow
            agent-desktop, then reopen voice input.
          </p>
        {/if}
      </div>
    {:else if voiceStore.finalText || voiceStore.partial}
      <div class="transcript">
        {#if voiceStore.finalText}<span class="final">{voiceStore.finalText}</span>{/if}
        {#if voiceStore.partial}<span class="partial">{voiceStore.partial}</span>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Transparent full-screen layer: catches a click-outside to dismiss WITHOUT
     dimming the app (this is a floating, non-modal panel). Below the panel. */
  .voice-scrim {
    position: fixed;
    inset: 0;
    z-index: 1999;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: default;
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

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: var(--r-full);
    border: 1px solid var(--line-default);
    color: var(--fg-3);
    background: var(--space-650);
  }
  .indicator.rec {
    color: #fff;
    border-color: transparent;
    background: #e5484d;
    animation: voice-pulse 1.4s ease-in-out infinite;
  }
  .indicator.err {
    color: #fff;
    border-color: transparent;
    background: #e5484d;
  }

  @keyframes voice-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(229, 72, 77, 0.45);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(229, 72, 77, 0);
    }
  }

  .status {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg-2);
  }
  .status.err {
    color: #ff8a8d;
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

  /* PRIMARY "Stop & insert" action: visually distinct from the × cancel so the
     finalize-vs-discard distinction is clear. */
  .stop-insert {
    flex: none;
    padding: 5px 11px;
    border: none;
    border-radius: var(--r-md);
    background: var(--accent, #3b82f6);
    color: #fff;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .stop-insert:hover {
    filter: brightness(1.08);
  }

  /* The live overlay region: committed (final) text reads normal; the in-progress
     (provisional) partial is dimmed + italic to signal it isn't final yet. */
  .transcript {
    font-size: 14px;
    line-height: 1.5;
    color: var(--fg-1);
    max-height: 30vh;
    overflow-y: auto;
    word-break: break-word;
  }
  .final {
    color: var(--fg-1);
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
  .partial {
    color: var(--fg-3);
    font-style: italic;
    opacity: 0.8;
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
