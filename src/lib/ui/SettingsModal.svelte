<script lang="ts">
  // The Settings MODAL. Opened from the title-bar gear button via the shared
  // `settingsModal` store. Lets the user choose which application opens each file
  // bucket — HTML, code, other — defaulting to the OS default ("System Default").
  // Each change is persisted immediately by the `openWith` store. Follows the
  // HelpModal backdrop/dialog pattern. Dismiss with Esc / backdrop / close button.

  import { settingsModal } from './settingsStore.svelte';
  import {
    openWith,
    APP_CHOICES,
    SYSTEM,
    type FileBucket
  } from '$lib/settings/openWith.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import { titleSettings } from '$lib/settings/titles.svelte';
  import {
    ensureModels,
    modelsStatus,
    modelsDiskUsage,
    deleteModels,
    formatBytes,
    type ModelsStatus
  } from '$lib/voice/models';
  import { modelDownload } from '$lib/voice/modelStore.svelte';

  // Voice-model readiness line: re-query whenever the modal is open and the
  // tier/polish selection changes, so the user sees "ready" vs "download". The
  // download is delegated to the shared `ensureModels` so the panel + settings
  // share one in-flight session (progress reflected in `modelDownload`).
  let modelStatus = $state<ModelsStatus | null>(null);
  // Reclaimable disk used by downloaded models (bytes); drives the delete control.
  let presentBytes = $state(0);
  // True while a delete is in flight, to disable the button and avoid double-fire.
  let deleting = $state(false);
  $effect(() => {
    if (!settingsModal.open) return;
    const tier = voice.prefs.modelTier;
    const polish = voice.prefs.polish;
    void modelsStatus(tier, polish).then((s) => {
      modelStatus = s;
    });
    void modelsDiskUsage().then((b) => {
      presentBytes = b;
    });
  });
  async function downloadModels() {
    await ensureModels(voice.prefs.modelTier, voice.prefs.polish);
    modelStatus = await modelsStatus(voice.prefs.modelTier, voice.prefs.polish);
    presentBytes = await modelsDiskUsage();
  }
  // Delete all downloaded models, then refresh status + usage so the row flips to
  // "None downloaded" and the Voice "Download" button reappears.
  async function deleteDownloaded() {
    deleting = true;
    try {
      await deleteModels();
      presentBytes = await modelsDiskUsage();
      modelStatus = await modelsStatus(voice.prefs.modelTier, voice.prefs.polish);
    } finally {
      deleting = false;
    }
  }

  // Sentinel for the "Custom…" select option (reveals a free-text app-name field).
  const CUSTOM = '__custom__';

  // The buckets, in display order, with human labels.
  const ROWS: { bucket: FileBucket; label: string }[] = [
    { bucket: 'code', label: 'Code files' },
    { bucket: 'html', label: 'HTML files' },
    { bucket: 'markdown', label: 'Markdown files' },
    { bucket: 'other', label: 'Other files' }
  ];

  // Per-row: is the value a curated choice, or a custom name needing the text field?
  // Derived from the live prefs so reopening reflects the saved value.
  function isCustom(bucket: FileBucket): boolean {
    const v = openWith.prefs[bucket];
    return v !== SYSTEM && !APP_CHOICES[bucket].includes(v);
  }

  // The <select>'s current value: SYSTEM, a known app, or the CUSTOM sentinel.
  function selectValue(bucket: FileBucket): string {
    return isCustom(bucket) ? CUSTOM : openWith.prefs[bucket];
  }

  function onSelect(bucket: FileBucket, value: string) {
    if (value === CUSTOM) {
      // Switch into custom mode with an empty name; the text field takes over.
      openWith.set(bucket, '');
    } else {
      openWith.set(bucket, value);
    }
  }

  function onCustomInput(bucket: FileBucket, value: string) {
    openWith.set(bucket, value);
  }

  function close() {
    settingsModal.close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

{#if settingsModal.open}
  <!-- Backdrop: a click outside the dialog closes. -->
  <div class="backdrop" role="presentation" onclick={close} onkeydown={onKeydown}>
    <!-- The dialog. stopPropagation on click so an inside click doesn't close. -->
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>Settings</h2>
        <button class="x" aria-label="Close" onclick={close}>×</button>
      </header>

      <section class="group">
        <span class="label">Open files with</span>
        <ul class="rows">
          {#each ROWS as row (row.bucket)}
            <li class="row">
              <span class="desc">{row.label}</span>
              <div class="control">
                <select
                  value={selectValue(row.bucket)}
                  onchange={(e) => onSelect(row.bucket, e.currentTarget.value)}
                >
                  <option value={SYSTEM}>System Default</option>
                  {#each APP_CHOICES[row.bucket] as app (app)}
                    <option value={app}>{app}</option>
                  {/each}
                  <option value={CUSTOM}>Custom…</option>
                </select>
                {#if isCustom(row.bucket)}
                  <input
                    class="custom"
                    type="text"
                    placeholder="App name (e.g. Cursor)"
                    value={openWith.prefs[row.bucket]}
                    oninput={(e) => onCustomInput(row.bucket, e.currentTarget.value)}
                  />
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>

      <section class="group">
        <span class="label">Voice</span>
        <ul class="rows">
          <li class="row">
            <span class="desc">Enable voice input</span>
            <div class="control">
              <input
                type="checkbox"
                checked={voice.prefs.enabled}
                onchange={(e) => voice.setEnabled(e.currentTarget.checked)}
              />
            </div>
          </li>
          <li class="row">
            <span class="desc">Clean up transcript (polish)</span>
            <div class="control">
              <input
                type="checkbox"
                checked={voice.prefs.polish}
                disabled={!voice.prefs.enabled}
                onchange={(e) => voice.setPolish(e.currentTarget.checked)}
              />
            </div>
          </li>
          <li class="row">
            <span class="desc">Transcription quality</span>
            <div class="control">
              <select
                value={voice.prefs.modelTier}
                disabled={!voice.prefs.enabled}
                onchange={(e) =>
                  voice.setModelTier(e.currentTarget.value as 'fast' | 'accurate')}
              >
                <option value="accurate">Accurate (large-v3-turbo)</option>
                <option value="fast">Fast (small)</option>
              </select>
            </div>
          </li>
          <li class="row">
            <span class="desc">Models</span>
            <div class="control">
              {#if modelDownload.active}
                <span class="model-status">Downloading… {modelDownload.percent}%</span>
              {:else if modelStatus?.ready}
                <span class="model-status ready">Ready</span>
              {:else if modelStatus}
                <button
                  type="button"
                  class="model-download"
                  disabled={!voice.prefs.enabled}
                  onclick={downloadModels}
                >
                  Download ({modelStatus.missing.length})
                </button>
              {:else}
                <span class="model-status">Checking…</span>
              {/if}
            </div>
          </li>
          <li class="row">
            <span class="desc">Downloaded models</span>
            <div class="control">
              {#if presentBytes > 0}
                <button
                  type="button"
                  class="model-delete"
                  disabled={deleting || modelDownload.active}
                  onclick={deleteDownloaded}
                >
                  {deleting ? 'Deleting…' : `Delete (${formatBytes(presentBytes)})`}
                </button>
              {:else}
                <span class="model-status">None downloaded</span>
              {/if}
            </div>
          </li>
        </ul>
      </section>

      <section class="group">
        <span class="label">Session titles</span>
        <ul class="rows">
          <li class="row">
            <span class="desc">Use cloud (Haiku) when on-device titles are unavailable</span>
            <div class="control">
              <input
                type="checkbox"
                checked={titleSettings.prefs.cloudFallback}
                onchange={(e) => titleSettings.setCloudFallback(e.currentTarget.checked)}
              />
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    background: rgba(4, 6, 10, 0.66);
    backdrop-filter: blur(3px);
  }

  .dialog {
    width: min(540px, calc(100vw - 32px));
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px 20px 20px;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-lg);
    color: var(--fg-1);
    font-family: var(--font-sans);
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
  }
  .x {
    width: 28px;
    height: 28px;
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

  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line-faint);
  }
  .row:last-child {
    border-bottom: none;
  }
  .desc {
    font-size: 13px;
    color: var(--fg-1);
    min-width: 0;
  }

  .control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  select,
  .custom {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    background: var(--space-650);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
  }
  /* Fixed width so all three rows' selects align (otherwise each auto-sizes to its
     widest option and the shorter browser names make the HTML row narrower). */
  select {
    width: 170px;
  }
  select:hover,
  .custom:hover {
    border-color: var(--line-strong);
  }
  select:focus,
  .custom:focus {
    outline: none;
    border-color: var(--accent);
  }
  .custom {
    width: 160px;
    cursor: text;
  }

  /* Voice toggles: native checkbox accented to the app color. */
  input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }
  select:disabled,
  input[type='checkbox']:disabled,
  .model-download:disabled,
  .model-delete:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Voice model readiness line. */
  .model-status {
    font-size: 13px;
    color: var(--fg-3);
  }
  .model-status.ready {
    color: var(--fg-2);
  }
  .model-download {
    font-size: 13px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--line-default);
    background: var(--space-650);
    color: var(--fg-1);
    cursor: pointer;
  }
  .model-download:not(:disabled):hover {
    background: var(--space-600);
  }

  /* Destructive variant: same shape as the download button, danger-tinted. */
  .model-delete {
    font-size: 13px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--line-default);
    background: var(--space-650);
    color: var(--danger, #e5484d);
    cursor: pointer;
  }
  .model-delete:not(:disabled):hover {
    border-color: var(--danger, #e5484d);
    background: var(--space-600);
  }
</style>
