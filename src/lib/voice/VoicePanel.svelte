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
  import { MicCapture } from './capture';
  import { classifyMicError, MIC_DENIED_GUIDANCE, micGuidanceFor } from './permission';
  import Icon from '../icons/Icon.svelte';

  // Mic-capture lifecycle is owned HERE (this feature owns VoicePanel), not in
  // +page.svelte. A single $effect watches `voiceStore.open`: on open it runs the
  // permission-gated start sequence; on close (or component teardown) it stops
  // capture and releases the OS mic. The audio handoff to the STT slice (onChunk
  // / onStop) is documented in capture.ts; this slice does not consume it yet.
  $effect(() => {
    if (!voiceStore.open) return;

    const capture = new MicCapture();
    let cancelled = false;

    voiceStore.setState('requesting');
    capture
      .start()
      .then(() => {
        if (cancelled) {
          // Panel closed mid-request: don't leave the mic on.
          capture.stop();
          return;
        }
        voiceStore.setState('recording');
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

    // Cleanup on close / teardown: stop the in-flight start and release the mic.
    return () => {
      cancelled = true;
      capture.stop();
    };
  });

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
      voiceStore.close();
    }
  }
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
    onclick={() => voiceStore.close()}
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
      <button class="x" aria-label="Stop voice input" onclick={() => voiceStore.close()}>×</button>
    </div>

    {#if voiceStore.state === 'denied' || voiceStore.state === 'error'}
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
</style>
