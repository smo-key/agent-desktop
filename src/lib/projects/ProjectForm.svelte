<script lang="ts">
  // The shared CREATE/EDIT form for a project, hosted by ProjectDialog. Top: a large
  // live avatar + the project name as a big title input. Then folder (picking it
  // prefills the name), the avatar choice (icon glyph OR an uploaded logo), and the
  // accent color (always editable, even with a logo — a logo only auto-pulls the
  // initial color, lightness-corrected via OKLCH). A single full-width Create / Save
  // button commits. Emits the draft via `onSave`.

  import type { Project, ProjectDraft } from './projects';
  import { PROJECT_ICON_CHOICES, PROJECT_COLOR_CHOICES, hexA } from './projects';
  import { processLogoFile } from './logo';
  import { pickFolder } from '../launcher/pick';
  import Icon from '../icons/Icon.svelte';
  import { tooltip } from '../ui/tooltip';
  import ProjectIcon from '../icons/ProjectIcon.svelte';

  let {
    mode,
    initial,
    onSave,
    onCancel
  }: {
    mode: 'create' | 'edit';
    initial?: Project;
    onSave: (draft: ProjectDraft) => void;
    onCancel: () => void;
  } = $props();

  // Seed the editable fields ONCE from the initial project (captured to a plain
  // local — the dialog remounts per open, so `initial` never changes mid-life).
  // svelte-ignore state_referenced_locally
  const seed = initial;
  let name = $state(seed?.name ?? '');
  let folder = $state(seed?.path ?? '');
  let icon = $state(seed?.icon ?? PROJECT_ICON_CHOICES[0].icon);
  let color = $state(seed?.color ?? PROJECT_ICON_CHOICES[0].color);
  let logo = $state<string | undefined>(seed?.logo);
  // The avatar is either an icon or a logo — start on whichever the project has.
  let appearance = $state<'icon' | 'logo'>(seed?.logo ? 'logo' : 'icon');

  let browsing = $state(false);
  let logoBusy = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  const canSave = $derived(name.trim() !== '' && folder.trim() !== '');

  // The chosen color isn't one of the palette swatches -> the custom well is active.
  const isCustomColor = $derived(
    !PROJECT_COLOR_CHOICES.some((c) => c.toLowerCase() === color.toLowerCase())
  );

  /** Last path segment of a folder, for prefilling the name. */
  function basename(p: string): string {
    const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
    return parts[parts.length - 1] ?? '';
  }

  async function browse() {
    if (browsing) return;
    browsing = true;
    try {
      const picked = await pickFolder(folder.trim() || undefined);
      if (picked) {
        folder = picked;
        // Folder first: seed the name from the folder when the user hasn't typed one.
        if (name.trim() === '') name = basename(picked);
      }
    } finally {
      browsing = false;
    }
  }

  async function onLogoChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-picking the same file later
    if (!file || logoBusy) return;
    logoBusy = true;
    try {
      const { dataUrl, color: extracted } = await processLogoFile(file);
      logo = dataUrl;
      color = extracted; // accent pulled from the logo (lightness-corrected), still editable
      appearance = 'logo';
    } catch (err) {
      console.error('logo processing failed', err);
    } finally {
      logoBusy = false;
    }
  }

  function removeLogo() {
    logo = undefined;
    appearance = 'icon';
  }

  function submit() {
    if (!canSave) return;
    // Either/or avatar: a logo is saved only in logo mode; icon mode clears it. The
    // color is saved in both modes.
    onSave({
      name: name.trim(),
      path: folder.trim(),
      icon,
      color,
      logo: appearance === 'logo' ? logo : undefined
    });
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="pf">
  <!-- Identity: a large live avatar + the name as the dialog's title input. -->
  <div class="pf-top">
    <div class="pf-preview">
      <ProjectIcon
        {icon}
        {color}
        logo={appearance === 'logo' ? logo : undefined}
        size={56}
        radius="var(--r-lg)"
      />
    </div>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="pf-title"
      autofocus
      bind:value={name}
      placeholder="Project name…"
      aria-label="Project name"
      onkeydown={onNameKey}
    />
  </div>

  <!-- Folder first — picking it seeds the name. -->
  <div class="pf-field">
    <span class="pf-flabel">Folder</span>
    <button class="pf-browse" onclick={browse} disabled={browsing}>
      <Icon name="folder" size={14} color="var(--fg-3)" />
      <span class="pf-folder" class:empty={!folder.trim()} use:tooltip={folder}>
        {folder.trim() || (browsing ? 'Opening…' : 'Choose folder…')}
      </span>
    </button>
  </div>

  <!-- Appearance: a live preview is above; here choose icon glyph OR a logo image. -->
  <div class="pf-field">
    <span class="pf-flabel" id="pf-appearance">Appearance</span>
    <div class="pf-seg" role="group" aria-labelledby="pf-appearance">
      <button type="button" class="seg" class:on={appearance === 'icon'} aria-pressed={appearance === 'icon'} onclick={() => (appearance = 'icon')}>
        <Icon name="box" size={13} color="currentColor" />
        Icon
      </button>
      <button type="button" class="seg" class:on={appearance === 'logo'} aria-pressed={appearance === 'logo'} onclick={() => (appearance = 'logo')}>
        <Icon name="image" size={13} color="currentColor" />
        Logo
      </button>
    </div>

    {#if appearance === 'icon'}
      <div class="icon-picker" role="group" aria-label="Icon glyph">
        {#each PROJECT_ICON_CHOICES as choice (choice.icon)}
          <button
            type="button"
            class="ipick"
            class:on={icon === choice.icon}
            style:border-color={icon === choice.icon ? hexA(color, 0.55) : undefined}
            style:background={icon === choice.icon ? hexA(color, 0.16) : undefined}
            aria-label={choice.icon}
            aria-pressed={icon === choice.icon}
            onclick={() => (icon = choice.icon)}
          >
            <Icon name={choice.icon} size={16} color={color} />
          </button>
        {/each}
      </div>
    {:else}
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        class="pf-fileinput"
        onchange={onLogoChosen}
      />
      {#if logo}
        <div class="pf-logo-row">
          <img class="pf-logo-thumb" src={logo} alt="" />
          <span class="pf-logo-label">Logo set · accent auto-pulled, editable below</span>
          <button type="button" class="pf-logo-x" onclick={removeLogo} aria-label="Remove logo">
            <Icon name="x" size={13} color="var(--fg-3)" />
          </button>
        </div>
      {:else}
        <button type="button" class="pf-logo-add" onclick={() => fileInput?.click()} disabled={logoBusy}>
          <Icon name="image" size={15} color="var(--fg-3)" />
          <span>{logoBusy ? 'Reading image…' : 'Upload an image'}</span>
        </button>
      {/if}
    {/if}
  </div>

  <!-- Color: the accent, chosen independently — applies whether the avatar is an
       icon or a logo (it tints the tile, list accents, and attention dots). -->
  <div class="pf-field">
    <span class="pf-flabel">Color</span>
    <div class="color-picker" role="group" aria-label="Accent color">
      {#each PROJECT_COLOR_CHOICES as c (c)}
        <button
          type="button"
          class="cpick"
          class:on={!isCustomColor && color.toLowerCase() === c.toLowerCase()}
          style:background={c}
          aria-label={`Color ${c}`}
          aria-pressed={!isCustomColor && color.toLowerCase() === c.toLowerCase()}
          onclick={() => (color = c)}
        ></button>
      {/each}
      <label class="cpick custom" class:on={isCustomColor} use:tooltip={'Custom color'}>
        <input type="color" bind:value={color} aria-label="Custom color" />
      </label>
    </div>
  </div>

  <button type="button" class="pf-submit" disabled={!canSave} onclick={submit}>
    {mode === 'edit' ? 'Save changes' : 'Create project'}
  </button>
</div>

<style>
  .pf {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Identity header: big avatar + big title input. */
  .pf-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .pf-preview {
    flex: none;
  }
  .pf-title {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line-subtle);
    /* Right padding clears the dialog's floating close button. */
    padding: 4px 30px 8px 2px;
    color: var(--fg-1);
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
    outline: none;
    transition: border-color var(--dur-fast);
  }
  .pf-title:focus {
    border-bottom-color: var(--blue-500);
  }
  .pf-title::placeholder {
    color: var(--fg-4);
  }

  .pf-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pf-flabel {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: var(--tracking-label, 0.07em);
    text-transform: uppercase;
    color: var(--fg-3);
  }

  /* Icon / Logo segmented control. */
  .pf-seg {
    display: flex;
    gap: 4px;
    padding: 3px;
    background: var(--space-900);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-md);
  }
  .seg {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 8px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-3);
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--dur-fast),
      color var(--dur-fast);
  }
  .seg:hover {
    color: var(--fg-2);
  }
  .seg.on {
    background: var(--space-700);
    color: var(--fg-1);
    box-shadow: var(--shadow-sm);
  }

  .icon-picker,
  .color-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ipick {
    width: 30px;
    height: 30px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--space-900);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition:
      border-color var(--dur-fast),
      background var(--dur-fast);
  }
  .ipick:hover {
    border-color: var(--line-strong);
  }
  .cpick {
    width: 26px;
    height: 26px;
    flex: none;
    padding: 0;
    border-radius: var(--r-full);
    border: 2px solid transparent;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    cursor: pointer;
    transition: transform var(--dur-fast);
  }
  .cpick:hover {
    transform: scale(1.08);
  }
  .cpick.on {
    border-color: var(--fg-1);
  }
  .cpick.custom {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: conic-gradient(
      from 0deg,
      #ff5d5d,
      #f0b341,
      #3ccb7f,
      #36c2c2,
      #4c8dff,
      #b98ae6,
      #ff5d5d
    );
  }
  .cpick.custom input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .pf-fileinput {
    display: none;
  }
  .pf-logo-add,
  .pf-browse {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    background: var(--space-900);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    padding: 9px 11px;
    cursor: pointer;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 12.5px;
    transition: border-color var(--dur-fast);
  }
  .pf-logo-add:hover,
  .pf-browse:hover {
    border-color: var(--line-strong);
  }
  .pf-logo-add:disabled {
    cursor: default;
    color: var(--fg-4);
  }
  .pf-logo-row {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--space-900);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    padding: 8px 9px;
  }
  .pf-logo-thumb {
    width: 24px;
    height: 24px;
    flex: none;
    border-radius: var(--r-sm);
    object-fit: cover;
  }
  .pf-logo-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--fg-3);
  }
  .pf-logo-x {
    flex: none;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .pf-logo-x:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .pf-folder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
  }
  .pf-folder.empty {
    color: var(--fg-4);
  }

  /* Full-width primary commit. */
  .pf-submit {
    width: 100%;
    box-sizing: border-box;
    margin-top: 2px;
    padding: 11px 16px;
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: var(--blue-500);
    color: #fff;
    font-family: var(--font-sans);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset;
    transition:
      background var(--dur-fast),
      opacity var(--dur-fast);
  }
  .pf-submit:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .pf-submit:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
