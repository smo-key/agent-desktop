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
  //
  // When `onOpenPrs` is provided (the footer only), an "open PRs awaiting review"
  // button is shown to the RIGHT of the PR button: it renders `openPrs` (a warning
  // glyph + the count when >0, else a neutral checkmark + `0`) and clicking opens
  // the repo's pull-requests page on GitHub. Without it no button shows.
  //
  // When `onCommit` is provided (the footer only), the MODIFIED (uncommitted-files)
  // pill becomes a BUTTON whenever `modified > 0` — clicking opens the commit
  // popover. It stays INERT (a plain display pill, no action) when `modified` is
  // 0/null, so a clean tree can't be clicked. The hover tooltip shows only the
  // COUNT of changed files (e.g. "3 uncommitted files").
  import Icon from '$lib/icons/Icon.svelte';
  import { tooltip } from '$lib/ui/tooltip';
  import type { GitStatus } from './snapshots.svelte';
  import { uncommittedCountTooltip } from './uncommittedTooltip';
  import FooterPopover from './FooterPopover.svelte';
  import type { CommitProject } from './commitPopover';
  import { spawnCommitFromPopover } from './commitPopover';

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
    prDisabled = false,
    onOpenPrs,
    openPrs,
    onCommit,
    commitProject = null
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
    onOpenPrs?: () => void;
    openPrs?: { icon: string; label: string; warning: boolean };
    /** When provided (footer only), the modified pill becomes a button that opens
     *  the commit popover. Without it the pill stays inert (project pane). */
    onCommit?: () => void;
    /** The project to commit to — used by the in-component popover to spawn the
     *  agent. Required whenever `onCommit` is wired; ignored otherwise. */
    commitProject?: CommitProject | null;
  } = $props();

  // The modified (uncommitted-files) pill is a clickable COMMIT button only when
  // the footer wired `onCommit` AND there are actually changes (`modified > 0`).
  // Otherwise it stays an inert display pill — a clean tree must not be clickable.
  const commitable = $derived(!!onCommit && (git?.modified ?? 0) > 0);

  // ── Commit popover state ───────────────────────────────────────────────────
  let commitPopoverOpen = $state(false);
  let commitPillEl = $state<HTMLButtonElement | null>(null);

  function openCommitPopover() {
    if (commitable) commitPopoverOpen = true;
  }

  function closeCommitPopover() {
    commitPopoverOpen = false;
  }

  function handleCommitNow() {
    if (commitProject) {
      spawnCommitFromPopover(commitProject);
    }
    closeCommitPopover();
  }
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
        {#if commitable}
          <!-- Changes present + footer wired a commit action: a clickable COMMIT
               button. Hover shows the count-only tooltip; clicking opens the commit
               popover which lists the file paths and pins a "Commit now" action. -->
          <button
            type="button"
            class="pill modified action"
            bind:this={commitPillEl}
            onclick={openCommitPopover}
            use:tooltip={uncommittedCountTooltip(git.modified)}
          >
            <Icon name="pencil" size={12} />
            <span class="txt">{git.modified}</span>
          </button>
        {:else}
          <!-- INERT: a clean tree (modified === 0) or no commit action wired. A
               clean tree shows NO tooltip; a non-zero count with no action shows
               the count-only summary. -->
          <span
            class="pill modified"
            class:zero={git.modified === 0}
            use:tooltip={git.modified === 0 ? '' : uncommittedCountTooltip(git.modified)}
          >
            <Icon name="pencil" size={12} />
            <span class="txt">{git.modified}</span>
          </span>
        {/if}
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
      {#if onOpenPrs && openPrs}
        <button
          type="button"
          class="pill openprs action"
          class:warn={openPrs.warning}
          onclick={onOpenPrs}
          use:tooltip={openPrs.warning
            ? `${openPrs.label} open pull request${openPrs.label === '1' ? '' : 's'} awaiting review — open on GitHub`
            : 'No open pull requests awaiting review — open on GitHub'}
        >
          <Icon name={openPrs.icon} size={12} />
          <span class="txt">{openPrs.label}</span>
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

<!-- Commit popover: opens above the modified pill when it is clicked and there
     are uncommitted changes. Lists the changed file paths in a scrollable body
     with a pinned "Commit now" action that spawns the agent directly (no confirm
     dialog — the user already saw the files and chose to act). -->
<FooterPopover
  open={commitPopoverOpen}
  anchor={commitPillEl}
  onClose={closeCommitPopover}
>
  {#snippet title()}
    Uncommitted changes
  {/snippet}

  {#snippet body()}
    {#if git?.files && git.files.length > 0}
      <ul class="cp-file-list">
        {#each git.files as file (file)}
          <li class="cp-file">{file}</li>
        {/each}
      </ul>
    {:else}
      <p class="cp-empty">No file paths available</p>
    {/if}
  {/snippet}

  {#snippet action()}
    <button type="button" class="cp-commit-btn" onclick={handleCommitNow}>
      Commit now
    </button>
  {/snippet}
</FooterPopover>

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
  /* The open-PRs-awaiting-review button sits immediately right of the PR button.
     Neutral (checkmark + `0`) when none await review; a caution tint (warning
     glyph + count) when one or more do. Shares `button.pill.action` hover/active. */
  .openprs {
    background: var(--space-750);
    color: var(--fg-4);
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .openprs.warn {
    background: var(--caution-tint);
    color: var(--caution-500);
    box-shadow: none;
  }

  /* ── Commit popover content (rendered inside FooterPopover's snippets) ── */

  /* File list inside the scrollable body: no bullet, tight spacing, monospace
     so paths are easy to read. */
  .cp-file-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .cp-file {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-2);
    padding: 5px 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cp-file:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--fg-1);
  }

  .cp-empty {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--fg-4);
    padding: 10px 12px;
    font-style: italic;
    margin: 0;
  }

  /* Primary action button — "Commit now" — full-width, caution accent. */
  .cp-commit-btn {
    width: 100%;
    background: var(--caution-tint);
    color: var(--caution-500);
    border: 1px solid color-mix(in srgb, var(--caution-500) 30%, transparent);
    border-radius: var(--r-sm);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    padding: 7px 12px;
    cursor: pointer;
    text-align: center;
  }

  .cp-commit-btn:hover {
    filter: brightness(1.15);
  }

  .cp-commit-btn:active {
    transform: translateY(0.5px);
  }
</style>
