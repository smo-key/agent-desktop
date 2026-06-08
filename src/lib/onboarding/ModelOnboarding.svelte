<script lang="ts">
  // First-launch model onboarding gate (capability `model-onboarding`). A
  // full-screen takeover shown by the route when `onboarding.visible` — i.e. the
  // on-device models the current voice selection needs are missing. It explains the
  // one-time download, lists what will be fetched (label + size + total), and offers
  // a primary Download (reusing `ensureModels` + the `modelDownload` progress store)
  // and a secondary "Skip for now" (session-only dismissal). On a successful
  // download a presence re-check flips `onboarding.visible` false and the route
  // stops rendering this overlay; a failure surfaces the error with a Retry.
  import { onboarding } from './onboarding.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import { ensureModels, downloadRows, formatBytes } from '$lib/voice/models';
  import { modelDownload } from '$lib/voice/modelStore.svelte';

  // The models to fetch (friendly label + human size) and their summed total.
  const list = $derived(downloadRows(onboarding.missing));

  // While a download is streaming. The error is surfaced once it ends unsuccessfully.
  const downloading = $derived(modelDownload.active);
  const error = $derived(modelDownload.error);

  /** Download the required models, then re-check presence so a complete set hides
   *  the gate. `ensureModels` never throws (it records failures into the store), so
   *  this is safe to await; the re-check leaves the gate up on a partial/failed run. */
  async function download(): Promise<void> {
    const { modelTier, polish } = voice.prefs;
    await ensureModels(modelTier, polish);
    await onboarding.check(modelTier, polish);
  }

  /** Skip for the current session (the gate returns on next launch if still missing). */
  function skip(): void {
    onboarding.dismiss();
  }
</script>

<div class="onboarding" role="dialog" aria-modal="true" aria-label="Set up on-device models">
  <div class="card">
    <h1 class="title">Agent Desktop</h1>
    <p class="subtitle">On-device voice &amp; smart titles need a one-time model download.</p>

    {#if list.rows.length > 0}
      <ul class="models" aria-label="Models to download">
        {#each list.rows as row (row.filename)}
          <li class="model">
            <span class="model-label">{row.label}</span>
            <span class="model-size">{row.size}</span>
          </li>
        {/each}
      </ul>
      <p class="total">Total to download: <strong>{formatBytes(list.totalBytes)}</strong></p>
    {/if}

    {#if downloading}
      <!-- Active download: a determinate strip driven by the shared progress store. -->
      <div class="progress" aria-live="polite">
        <div class="prog-row">
          <span>Downloading…</span>
          <span class="prog-pct">{modelDownload.percent}%</span>
        </div>
        <div class="prog-track">
          <div class="prog-fill" style:width={`${modelDownload.percent}%`}></div>
        </div>
      </div>
    {:else}
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={() => void download()}>
          {error ? 'Retry download' : 'Download models'}
        </button>
        <button type="button" class="secondary" onclick={skip}>Skip for now</button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Opaque full-window takeover above everything else. */
  .onboarding {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--space-950);
    color: var(--fg-1);
    font-family: var(--font-sans);
  }

  .card {
    width: 100%;
    max-width: 420px;
    background: var(--bg-surface);
    border: 1px solid var(--space-650);
    border-radius: 14px;
    box-shadow: var(--shadow-lg);
    padding: 28px 28px 24px;
    text-align: center;
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .subtitle {
    margin: 8px 0 20px;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--fg-3);
  }

  .models {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    border-top: 1px solid var(--space-700);
  }

  .model {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 4px;
    border-bottom: 1px solid var(--space-700);
    font-size: 13.5px;
  }

  .model-label {
    color: var(--fg-2);
  }

  .model-size {
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .total {
    margin: 0 0 22px;
    font-size: 13px;
    color: var(--fg-3);
  }

  .total strong {
    color: var(--fg-1);
    font-weight: 600;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  button {
    font-family: inherit;
    font-size: 14px;
    border-radius: 9px;
    cursor: pointer;
    padding: 11px 16px;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }

  .primary {
    background: var(--accent);
    color: var(--fg-on-accent);
    border: 1px solid var(--accent);
    font-weight: 600;
  }

  .primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .secondary {
    background: transparent;
    color: var(--fg-3);
    border: 1px solid transparent;
  }

  .secondary:hover {
    color: var(--fg-1);
    background: var(--bg-hover);
  }

  .error {
    margin: 0 0 14px;
    font-size: 12.5px;
    line-height: 1.5;
    color: #ff8a8d;
  }

  /* Determinate download strip (mirrors the VoicePanel "preparing" visual). */
  .progress {
    margin-top: 4px;
  }

  .prog-row {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--fg-3);
    margin-bottom: 7px;
  }

  .prog-pct {
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }

  .prog-track {
    height: 6px;
    border-radius: 999px;
    background: var(--space-700);
    overflow: hidden;
  }

  .prog-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 160ms ease;
  }
</style>
