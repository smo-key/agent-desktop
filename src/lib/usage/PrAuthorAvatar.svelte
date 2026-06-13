<script lang="ts">
  // The PR author's avatar for an open-PR popover row: the author's GitHub avatar
  // image (https://github.com/<login>.png), with the author's name shown on hover.
  // Degrades gracefully — a bot author shows a bot glyph; a human whose avatar
  // fails to load (offline / proxy / 404) shows their initial; an unknown author
  // shows a neutral placeholder glyph. The URL/label/initial logic is the pure,
  // unit-tested helpers in openPrsActions.ts; this is a thin renderer over them.
  import Icon from '$lib/icons/Icon.svelte';
  import { tooltip } from '$lib/ui/tooltip';
  import {
    authorAvatarUrl,
    authorInitial,
    authorLabel,
    type PrAuthor
  } from '$lib/projects/openPrsActions';

  let { author, size = 16 }: { author: PrAuthor | null; size?: number } = $props();

  // The remote avatar URL (null when there's no usable login), requested at 2x for
  // crispness. Resetting `failed` whenever the URL changes lets a re-used row
  // component retry a fresh author's image rather than staying on the fallback.
  const url = $derived(author ? authorAvatarUrl(author.login, size * 2) : null);
  let failed = $state(false);
  $effect(() => {
    void url;
    failed = false;
  });

  // Show the real image only for a non-bot author whose URL hasn't failed to load.
  const showImage = $derived(!!author && !author.isBot && url != null && !failed);
</script>

<span
  class="pr-avatar"
  style:width={`${size}px`}
  style:height={`${size}px`}
  use:tooltip={author ? authorLabel(author) : 'unknown author'}
>
  {#if showImage}
    <img
      class="pr-avatar-img"
      src={url}
      alt=""
      width={size}
      height={size}
      referrerpolicy="no-referrer"
      onerror={() => (failed = true)}
    />
  {:else if author?.isBot}
    <Icon name="bot" size={Math.round(size * 0.7)} />
  {:else if author}
    <span class="pr-avatar-initial" style:font-size={`${Math.round(size * 0.6)}px`}>
      {authorInitial(author)}
    </span>
  {:else}
    <Icon name="git-pull-request" size={Math.round(size * 0.7)} />
  {/if}
</span>

<style>
  .pr-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border-radius: var(--r-full);
    overflow: hidden;
    background: var(--space-750);
    color: var(--fg-3);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .pr-avatar-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--r-full);
  }
  .pr-avatar-initial {
    font-family: var(--font-sans);
    font-weight: 600;
    line-height: 1;
    color: var(--fg-2);
  }
</style>
