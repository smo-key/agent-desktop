<script lang="ts">
  // The focused pane's git status as a row of PILLS, statusline-style:
  //   [⎇ branch]  [↓ behind]  [↑ ahead]  [• dirty]
  // branch is a neutral pill; behind a red pill (dim when 0); ahead a yellow pill
  // (hidden when 0); dirty a caution pill / clean a green check pill. Counts hide
  // when null (git couldn't answer — no remote / no upstream / off-repo). Icons
  // inherit the pill's color via currentColor.
  import Icon from '$lib/icons/Icon.svelte';
  import type { GitStatus } from './snapshots.svelte';

  let { git }: { git: GitStatus | null } = $props();
</script>

<div class="git" title="Focused pane git status">
  {#if git && git.branch}
    <span class="pill branch" title={`branch ${git.branch}`}>
      <Icon name="git-branch" size={12} />
      <span class="txt">{git.branch}</span>
    </span>
    {#if git.behind != null}
      <span class="pill behind" class:zero={git.behind === 0} title={`${git.behind} behind origin/main`}>
        <Icon name="arrow-down" size={12} />
        <span class="txt">{git.behind}</span>
      </span>
    {/if}
    {#if git.ahead != null && git.ahead > 0}
      <span class="pill ahead" title={`${git.ahead} ahead of upstream`}>
        <Icon name="arrow-up" size={12} />
        <span class="txt">{git.ahead}</span>
      </span>
    {/if}
    {#if git.dirty === true}
      <span class="pill dirty" title="uncommitted changes">
        <span class="dot" aria-hidden="true"></span>
        <span class="txt">dirty</span>
      </span>
    {:else if git.dirty === false}
      <span class="pill clean" title="clean">
        <Icon name="check" size={12} />
      </span>
    {/if}
  {:else}
    <span class="pill branch dim" title="no git info">
      <Icon name="git-branch" size={12} />
      <span class="txt">—</span>
    </span>
  {/if}
</div>

<style>
  .git {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--r-full);
    font-size: 11px;
    font-weight: 600;
    background: var(--space-750);
    color: var(--fg-2);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .pill .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch {
    max-width: 220px;
  }
  .branch.dim {
    color: var(--fg-4);
  }
  .behind {
    background: var(--abort-tint);
    color: var(--abort-500);
    box-shadow: none;
  }
  .behind.zero {
    background: var(--space-750);
    color: var(--fg-4);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .ahead {
    background: var(--caution-tint);
    color: var(--caution-500);
    box-shadow: none;
  }
  .dirty {
    background: var(--caution-tint);
    color: var(--caution-500);
    box-shadow: none;
  }
  .dirty .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .clean {
    background: var(--nominal-tint);
    color: var(--nominal-500);
    box-shadow: none;
    padding: 0 6px;
  }
</style>
