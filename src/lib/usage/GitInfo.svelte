<script lang="ts">
  // The focused pane's git status, styled like the user's Claude statusline:
  //   ⎇ branch  ↓behind  ↑ahead  ●dirty
  // branch dim; behind red (grey when 0); ahead yellow (hidden when 0); dirty an
  // amber dot (green ✓ when clean). Counts are hidden when null (git couldn't
  // answer — no remote / no upstream / off-repo).
  import type { GitStatus } from './snapshots.svelte';

  let { git }: { git: GitStatus | null } = $props();
</script>

<div class="git" title="Focused pane git status">
  {#if git && git.branch}
    <span class="branch">⎇ {git.branch}</span>
    {#if git.behind != null}
      <span class="behind" class:zero={git.behind === 0}>↓{git.behind}</span>
    {/if}
    {#if git.ahead != null && git.ahead > 0}
      <span class="ahead">↑{git.ahead}</span>
    {/if}
    {#if git.dirty === true}
      <span class="dirty" title="uncommitted changes">●</span>
    {:else if git.dirty === false}
      <span class="clean" title="clean">✓</span>
    {/if}
  {:else}
    <span class="branch dim">⎇ —</span>
  {/if}
</div>

<style>
  .git {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }
  .branch {
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .branch.dim {
    color: var(--fg-4);
  }
  .behind {
    color: var(--abort-500);
  }
  .behind.zero {
    color: var(--fg-4);
  }
  .ahead {
    color: var(--caution-500);
  }
  .dirty {
    color: var(--caution-500);
    font-size: 9px;
  }
  .clean {
    color: var(--nominal-500);
    font-size: 10px;
  }
</style>
