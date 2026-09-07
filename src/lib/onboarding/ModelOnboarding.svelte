<script lang="ts">
  // First-launch model onboarding gate (capability `model-onboarding`). A
  // full-screen takeover shown by the route when `onboarding.visible` — i.e. the
  // on-device models the current voice selection needs are missing. It explains the
  // one-time download, lists what will be fetched (label + size + total), and offers
  // a primary Download (reusing `ensureModels` + the `modelDownload` progress store)
  // and a secondary "Skip for now". The gate is shown at most once per user: both
  // Skip and a completed download record a persisted `seen` flag so it never returns.
  // On a successful download a presence re-check flips `onboarding.visible` false and
  // the route stops rendering this overlay; a failure surfaces the error with a Retry.
  import { onboarding } from './onboarding.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import { ensureModels, downloadRows, formatBytes } from '$lib/voice/models';
  import { modelDownload } from '$lib/voice/modelStore.svelte';
  import { autofocus } from '$lib/ui/autofocus';

  // The models to fetch (friendly label + human size) and their summed total.
  const list = $derived(downloadRows(onboarding.missing));

  // Leading-edge in-flight guard. `modelDownload.active` only flips true AFTER the
  // initial `voice_models_status` IPC inside `ensureModels` resolves, so relying on
  // it alone would leave the button clickable during that round-trip — a fast
  // double-click could launch two concurrent downloads against the shared store and
  // the same files. `starting` is set synchronously on click to close that window.
  let starting = $state(false);

  // The button is suppressed whenever a download is starting or streaming.
  const busy = $derived(starting || modelDownload.active);
  const error = $derived(modelDownload.error);

  // Bytes received so far, summed across every in-flight model, for a concrete
  // "X / Y" readout beside the percentage. Denominator is the known expected total
  // (`list.totalBytes`) so it stays stable even before the first progress event
  // populates per-model totals. Zero until streaming begins (the "Preparing…" window).
  const received = $derived(
    Object.values(modelDownload.perModel).reduce((n, m) => n + (m?.received ?? 0), 0),
  );

  /** Download the required models, then re-check presence so a complete set hides
   *  the gate. `ensureModels` never throws (it records failures into the store), so
   *  this is safe to await; the re-check leaves the gate up on a partial/failed run.
   *  A complete set also records the persisted one-time flag so the gate never
   *  returns. Guarded against re-entrancy via `starting`. */
  async function download(): Promise<void> {
    if (busy) return;
    starting = true;
    try {
      const { modelTier, polish } = voice.prefs;
      await ensureModels(modelTier, polish);
      await onboarding.check(modelTier, polish);
      if (onboarding.status?.ready) onboarding.markSeen();
    } finally {
      starting = false;
    }
  }

  /** Skip the one-time download. Records the persisted `seen` flag so the gate does
   *  not return on a later launch even while the models remain missing. */
  function skip(): void {
    onboarding.dismiss();
  }
</script>

<!-- The gate takes over the BODY area only — it is offset from the top by the
     titlebar height (see `.onboarding` below) so the app's persistent titlebar
     stays visible above it. That titlebar is the window-drag region, so the
     window remains movable (e.g. across monitors) for the whole gate, including
     the one-time download; the gate itself needs no drag region. -->
<div class="onboarding" role="dialog" aria-modal="true" aria-label="Set up on-device models">
  <div class="card">
    <img class="logomark" src="/logomark.svg" alt="" aria-hidden="true" width="40" height="40" />
    <p class="kicker">One-time setup</p>
    <h1 class="title">Set up on-device models</h1>
    <p class="subtitle">
      Voice dictation and smart titles run entirely on your device — nothing leaves your
      machine. They need a one-time model download to get started.
    </p>

    {#if list.rows.length > 0 && !busy}
      <ul class="models" aria-label="Models to download">
        {#each list.rows as row (row.filename)}
          <li class="model">
            <span class="model-label">{row.label}</span>
            <span class="model-size">{row.size}</span>
          </li>
        {/each}
      </ul>
      <p class="total"><span>Total download</span><strong>{formatBytes(list.totalBytes)}</strong></p>
    {/if}

    {#if busy}
      <!-- Active download: a determinate strip driven by the shared progress store.
           Also covers the brief pre-stream window (`starting`) so the button can't be
           re-triggered before progress begins. The byte readout makes a slow or
           stalled connection legible — a bare percent looks identical whether it is
           moving or wedged. -->
      <div class="progress" aria-live="polite">
        <div class="prog-row">
          <span>{starting && received === 0 ? 'Preparing…' : 'Downloading…'}</span>
          <span class="prog-pct">{modelDownload.percent}%</span>
        </div>
        <div class="prog-track">
          <div class="prog-fill" style:transform={`scaleX(${modelDownload.percent / 100})`}></div>
        </div>
        {#if list.totalBytes > 0}
          <p class="prog-bytes">{formatBytes(received)} / {formatBytes(list.totalBytes)}</p>
        {/if}
      </div>
    {:else}
      {#if error}
        <p class="error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span>{error}</span>
        </p>
      {/if}
      <div class="actions">
        <!-- Focus the primary CTA on open so Enter starts the (Retry) download. -->
        <button type="button" class="primary" onclick={() => void download()} use:autofocus>
          {error ? 'Retry download' : 'Download models'}
        </button>
        <button type="button" class="secondary" onclick={skip}>Skip for now</button>
      </div>
      <p class="hint">
        You can do this later from Settings, or it happens automatically the first time you
        use voice.
      </p>
    {/if}
  </div>
</div>

<style>
  /* Opaque takeover of the body area. Offset from the top by the titlebar height
     so the app's persistent, draggable titlebar stays visible above the gate. */
  .onboarding {
    position: fixed;
    inset: var(--titlebar-h, 40px) 0 0 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-6);
    background: var(--space-950);
    color: var(--fg-1);
    font-family: var(--font-sans);
  }

  .card {
    width: 100%;
    max-width: 420px;
    background: var(--bg-surface);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-lg);
    padding: var(--s-8) var(--s-8) var(--s-6);
    text-align: center;
  }

  .logomark {
    display: block;
    width: 40px;
    height: 40px;
    margin: 0 auto var(--s-4);
  }

  /* Mono micro-label — the app's signature "instrumented" voice (DESIGN.md). */
  .kicker {
    margin: 0 0 var(--s-2);
    font-family: var(--font-mono);
    font-size: var(--t-caption);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--t-h2);
    font-weight: 600;
    line-height: var(--lh-tight);
    letter-spacing: var(--tracking-tight);
    text-wrap: balance;
  }

  .subtitle {
    margin: var(--s-2) 0 var(--s-5);
    font-size: var(--t-body-s);
    line-height: var(--lh-normal);
    color: var(--fg-2);
    text-wrap: pretty;
  }

  .models {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-subtle);
    text-align: left;
  }

  .model {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-1);
    border-bottom: 1px solid var(--line-subtle);
    font-size: var(--t-body-s);
  }

  .model-label {
    color: var(--fg-2);
  }

  /* Numerics are mono + tabular — the brand's telemetry signature. */
  .model-size {
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: var(--t-label);
    font-variant-numeric: tabular-nums;
  }

  .total {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: var(--s-3) 0 var(--s-5);
    padding: 0 var(--s-1);
    text-align: left;
    font-size: var(--t-body-s);
    color: var(--fg-3);
  }

  .total strong {
    color: var(--fg-1);
    font-weight: 600;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  button {
    font-family: inherit;
    font-size: var(--t-body);
    font-weight: 600;
    border-radius: var(--r-md);
    cursor: pointer;
    padding: var(--s-3) var(--s-4);
    border: 1px solid transparent;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Matches the app's `.btn-primary`: white on NASA blue with a 1px top inset. */
  .primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset;
  }

  .primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .primary:active {
    transform: translateY(1px);
  }

  .secondary {
    background: transparent;
    color: var(--fg-2);
    border-color: transparent;
  }

  .secondary:hover {
    color: var(--fg-1);
    background: var(--bg-hover);
  }

  .hint {
    margin: var(--s-3) 0 0;
    font-size: var(--t-caption);
    line-height: var(--lh-snug);
    color: var(--fg-3);
  }

  /* Error: a tinted alert block led by an icon, so the failure never rests on
     color alone (paired with role="alert" for assistive tech). */
  .error {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    margin: 0 0 var(--s-3);
    padding: var(--s-3);
    text-align: left;
    background: var(--abort-tint);
    border: 1px solid rgba(242, 86, 75, 0.25);
    border-radius: var(--r-md);
    font-size: var(--t-body-s);
    line-height: var(--lh-normal);
    color: var(--fg-1);
  }

  .error svg {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 1px;
    color: var(--abort-500);
  }

  /* Determinate download strip (mirrors the VoicePanel "preparing" visual). */
  .progress {
    margin-top: var(--s-1);
  }

  .prog-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: var(--t-body-s);
    color: var(--fg-2);
    margin-bottom: var(--s-2);
  }

  .prog-pct {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--fg-1);
  }

  .prog-track {
    height: 6px;
    border-radius: var(--r-full);
    background: var(--space-700);
    overflow: hidden;
  }

  /* Scale on the X axis instead of animating `width` (no layout thrash); the
     track's clip + radius give the rounded ends. */
  .prog-fill {
    height: 100%;
    width: 100%;
    transform-origin: left;
    background: var(--accent);
    transition: transform var(--dur-base) var(--ease-out);
  }

  .prog-bytes {
    margin: var(--s-2) 0 0;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--t-caption);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  /* Reduced motion: drop every transition and the press nudge; states still
     update, just without animation (a committed accessibility rule). */
  @media (prefers-reduced-motion: reduce) {
    button,
    .prog-fill {
      transition: none;
    }

    .primary:active {
      transform: none;
    }
  }
</style>
