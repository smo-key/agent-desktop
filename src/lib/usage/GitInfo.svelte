<script lang="ts">
  // The focused pane's (or a project's) git status as a row of PILLS:
  //   [⎇ branch]  [↓ behind]  [↑ ahead]  [✎ modified]
  // branch is a neutral pill; behind a red pill (dim when 0); ahead a yellow pill;
  // modified a caution pill carrying the COUNT of changed paths with a pencil icon
  // (dim when 0). Counts hide when null (git couldn't answer) UNLESS `always` is
  // set — the project pane forces all three indicators visible even at zero/clean.
  // `stack` splits the branch onto its own line above the indicators (the project
  // pane wants branch on row 2, the three indicators on row 3); the footer leaves
  // it off and everything flows inline. Icons inherit the pill color via currentColor.
  //
  // When `onPush`/`onPull` are provided, the ahead (↑) and behind (↓) indicators
  // become CLICKABLE buttons that push / pull the underlying project (same behavior
  // as the project pane's context-menu Push/Pull); without them the indicators are
  // plain display pills. While `busy` is set (a push/pull is already running for
  // this project) BOTH buttons are disabled so the operation can't be re-triggered.
  //
  // When `onPickBranch` is provided (the footer only), the BRANCH pill becomes a
  // button that opens the branch picker; without it the branch stays a read-only
  // display pill (the project pane keeps it read-only), mirroring the push/pull
  // span↔button switch.
  //
  // When `onPr` is provided (the footer only), a PR button is shown immediately
  // to the RIGHT of the modified (edited-files) pill: clicking opens the existing
  // PR (when `prExists`) or a create-PR confirm. It is DISABLED when `prDisabled`
  // (on the base branch, or no branch/project). Without `onPr` no PR button shows
  // (the project pane omits it), mirroring the other footer-only switches.
  import Icon from '$lib/icons/Icon.svelte';
  import { tooltip } from '$lib/ui/tooltip';
  import type { GitStatus } from './snapshots.svelte';

  let {
    git,
    always = false,
    stack = false,
    onPush,
    onPull,
    busy = false,
    onPickBranch,
    onPr,
    prExists = false,
    prDisabled = false
  }: {
    git: GitStatus | null;
    always?: boolean;
    stack?: boolean;
    onPush?: () => void;
    onPull?: () => void;
    busy?: boolean;
    onPickBranch?: () => void;
    onPr?: () => void;
    prExists?: boolean;
    prDisabled?: boolean;
  } = $props();
</script>

<div class="git" class:stacked={stack}>
  {#if git && git.branch}
    <span class="grp branchgrp">
      {#if onPickBranch}
        <button
          type="button"
          class="pill branch action"
          onclick={onPickBranch}
          use:tooltip={`On branch ${git.branch} — switch branch`}
        >
          <Icon name="git-branch" size={12} />
          <span class="txt">{git.branch}</span>
        </button>
      {:else}
        <span class="pill branch" use:tooltip={`On branch ${git.branch}`}>
          <Icon name="git-branch" size={12} />
          <span class="txt">{git.branch}</span>
        </span>
      {/if}
    </span>
    <span class="grp ind">
      {#if always || git.behind != null}
        {#if onPull}
          <button
            type="button"
            class="pill behind action"
            class:zero={(git.behind ?? 0) === 0}
            onclick={onPull}
            disabled={busy}
            use:tooltip={busy ? 'Sync in progress…' : 'Pull from origin'}
          >
            <Icon name="arrow-down" size={12} />
            <span class="txt">{git.behind ?? 0}</span>
          </button>
        {:else}
          <span
            class="pill behind"
            class:zero={(git.behind ?? 0) === 0}
            use:tooltip={`${git.behind ?? 0} commit${(git.behind ?? 0) === 1 ? '' : 's'} behind origin/main — pull to catch up`}
          >
            <Icon name="arrow-down" size={12} />
            <span class="txt">{git.behind ?? 0}</span>
          </span>
        {/if}
      {/if}
      {#if always || (git.ahead != null && git.ahead > 0)}
        {#if onPush}
          <button
            type="button"
            class="pill ahead action"
            class:zero={(git.ahead ?? 0) === 0}
            onclick={onPush}
            disabled={busy}
            use:tooltip={busy ? 'Sync in progress…' : 'Push to origin'}
          >
            <Icon name="arrow-up" size={12} />
            <span class="txt">{git.ahead ?? 0}</span>
          </button>
        {:else}
          <span
            class="pill ahead"
            class:zero={(git.ahead ?? 0) === 0}
            use:tooltip={`${git.ahead ?? 0} commit${(git.ahead ?? 0) === 1 ? '' : 's'} ahead of upstream — push to publish`}
          >
            <Icon name="arrow-up" size={12} />
            <span class="txt">{git.ahead ?? 0}</span>
          </span>
        {/if}
      {/if}
      {#if git.modified != null}
        <span class="pill modified" class:zero={git.modified === 0} use:tooltip={`${git.modified} uncommitted file${git.modified === 1 ? '' : 's'} changed`}>
          <Icon name="pencil" size={12} />
          <span class="txt">{git.modified}</span>
        </span>
      {:else if always}
        <span class="pill modified zero" use:tooltip={'No uncommitted changes'}>
          <Icon name="pencil" size={12} />
          <span class="txt">0</span>
        </span>
      {:else if git.dirty === true}
        <span class="pill modified" use:tooltip={'Uncommitted changes in the working tree'}>
          <Icon name="pencil" size={12} />
        </span>
      {:else if git.dirty === false}
        <span class="pill clean" use:tooltip={'Working tree clean'}>
          <Icon name="check" size={12} />
        </span>
      {/if}
      {#if onPr}
        <button
          type="button"
          class="pill pr action"
          class:exists={prExists}
          onclick={onPr}
          disabled={prDisabled}
          use:tooltip={prDisabled
            ? 'Open a pull request — switch off the base branch first'
            : prExists
              ? 'Open this branch’s pull request on GitHub'
              : 'Create a pull request into main'}
        >
          <Icon name="git-pull-request" size={12} />
          <span class="txt">PR</span>
        </button>
      {/if}
    </span>
  {:else}
    <span class="pill branch dim" use:tooltip={'No git repository for this pane'}>
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
  /* Inline (footer): the group wrappers vanish so all pills flow in one row. */
  .grp {
    display: contents;
  }
  /* Stacked (project pane): branch on its own line, indicators wrapping below. */
  .git.stacked {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .git.stacked .grp {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
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
  /* A clickable indicator (footer push/pull): reset the button chrome to match the
     display pill, add a pointer + subtle hover lift so it reads as actionable. */
  button.pill {
    /* Inherit only the family (drop the UA button font); keep `.pill`'s 11px /
       600 so a push/pull button matches the display pills exactly. */
    font-family: inherit;
    border: none;
    cursor: pointer;
  }
  button.pill.action:hover {
    filter: brightness(1.15);
  }
  button.pill.action:active {
    transform: translateY(0.5px);
  }
  /* While a sync is in flight both buttons are disabled — dim them and drop the
     hover/active affordances so they read as non-interactive. */
  button.pill.action:disabled {
    cursor: default;
    opacity: 0.5;
    filter: none;
    transform: none;
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
  .ahead.zero {
    background: var(--space-750);
    color: var(--fg-4);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .modified {
    background: var(--caution-tint);
    color: var(--caution-500);
    box-shadow: none;
  }
  .modified.zero {
    background: var(--space-750);
    color: var(--fg-4);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .clean {
    background: var(--nominal-tint);
    color: var(--nominal-500);
    box-shadow: none;
    padding: 0 6px;
  }
  /* The PR button sits immediately right of the modified pill. Neutral by default
     (create intent); a brighter accent tint when an open PR already exists (open
     intent). The shared `button.pill.action` rules above carry hover/active/disabled. */
  .pr {
    background: var(--space-750);
    color: var(--fg-2);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .pr.exists {
    background: var(--blue-tint);
    color: var(--info-500);
    box-shadow: none;
  }
</style>
