<script lang="ts">
  // The single persistent footer. LEFT (mirrors the rail + agent panes above):
  // the focused agent's project chip + the combined 5h/7d limit bars. RIGHT
  // (mirrors the terminal): the focused agent's git (statusline-style) then its
  // context bar. In grid view the right group's left edge is ALIGNED under the
  // terminal pane (computed from the live split ratios, so it tracks gutter
  // drags); elsewhere it falls back to right-aligned. All math is in the pure,
  // tested `footerView` / `terminalLeftFraction`; this is the thin reactive shell.
  import { snapshots } from './snapshots.svelte';
  import { footerView, footerGitProjectId } from './footerView';
  import { terminalLeftFraction } from './footerGeometry';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectForId } from '$lib/projects/projects';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { projectGit } from '$lib/projects/projectGit.svelte';
  import { pushProject, pullProject } from '$lib/projects/projectGitActions';
  import { view as topView } from '$lib/overview/view.svelte';
  import LimitBars from './LimitBars.svelte';
  import GitInfo from './GitInfo.svelte';
  import ContextBar from './ContextBar.svelte';
  import { friendlyTime } from '$lib/overview/friendlyTime';
  import { tooltip } from '$lib/ui/tooltip';

  /** Total session cost as "$1.24", or an em dash when unknown. */
  function costLabel(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }

  // The fixed width of the session rail (matches `.body nav.rail` in +page.svelte).
  const RAIL_PX = 200;

  // The focused pane id and the project bound to it (from the active workspace's
  // registry). Reading `workspace.active`/`focusedPaneId` keeps this reactive to
  // focus + workspace switches.
  const focusedPaneId = $derived(workspace.focusedPaneId);
  const projectId = $derived(
    focusedPaneId ? (workspace.active?.registry[focusedPaneId]?.projectId ?? null) : null
  );

  const view = $derived(
    footerView(snapshots.byPane, focusedPaneId, projectId, projects.list)
  );

  // The FOLDER git shown on the left (before the limit bars): the focused pane's
  // project, else the panel's current selection (so it stays meaningful in the
  // overview, where no pane is focused). Folder-based via `projectGit`, so it
  // shows a project's branch + ahead/behind/modified even with no agent running.
  const gitProject = $derived(
    projectForId(projects.list, footerGitProjectId(projectId, projectFilter.selected))
  );
  const folderGit = $derived(projectGit.forPath(gitProject?.path ?? null));

  // Push/Pull handlers for the footer's git indicators — present only when a real
  // project with a folder backs the footer git, so the ↑/↓ pills become Push/Pull
  // buttons with the SAME behavior as the project pane's context-menu actions
  // (success toast; interactive terminal in the folder on failure).
  const onPush = $derived(
    gitProject?.path ? () => void pushProject(gitProject.path, gitProject.name, gitProject.id) : undefined
  );
  const onPull = $derived(
    gitProject?.path ? () => void pullProject(gitProject.path, gitProject.name, gitProject.id) : undefined
  );

  // The terminal area's left edge as a fraction [0,1] of the surface, or null when
  // there's no terminal pane / not in grid view. A "terminal" pane is a non-claude
  // (shell) pane; agents are claude panes. Reading the active tree + registry keeps
  // this reactive to gutter drags (a resize commits a new tree).
  const termFrac = $derived.by(() => {
    if (!topView.isGrid) return null;
    const entry = workspace.active;
    if (!entry) return null;
    const reg = entry.registry;
    return terminalLeftFraction(
      entry.ws.root,
      (pid) => reg[pid]?.program !== undefined && reg[pid].program !== 'claude'
    );
  });

  // A 1-second heartbeat clock (unix SECONDS) so the limit bars' time-remaining
  // shorthand counts down on its own without needing a new snapshot.
  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const id = setInterval(() => {
      now = Math.floor(Date.now() / 1000);
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<footer
  class="app-footer"
  class:aligned={termFrac !== null}
  style:--term-left={termFrac ?? 0}
  style:--rail-px={`${RAIL_PX}px`}
  aria-label="Status footer"
>
  <div class="zone left">
    <div class="left-git"><GitInfo git={folderGit} always {onPush} {onPull} /></div>
    <span class="sep" aria-hidden="true"></span>
    <LimitBars fiveHour={view.fiveHour} sevenDay={view.sevenDay} {now} />
  </div>

  <div class="zone right">
    <ContextBar pct={view.context} />
    <span class="sep" aria-hidden="true"></span>
    <span class="metric" use:tooltip={'Total cost of the focused session'}>{costLabel(view.cost)}</span>
    <span class="metric dim" use:tooltip={'Time since the last message in the focused session'}>{friendlyTime(view.lastTs, now * 1000)}</span>
  </div>
</footer>

<style>
  .app-footer {
    flex: 0 0 auto;
    /* Own stacking context above the body so the (full-height) collapsed Workspace
       selector never paints over the footer. */
    position: relative;
    z-index: 5;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    /* No horizontal padding so `100%`/`200px` in the alignment calc map to true
       window x-coords; the zones carry their own edge padding instead. */
    padding: 6px 0;
    background: var(--space-900);
    border-top: 1px solid var(--line-subtle);
    user-select: none;
    -webkit-user-select: none;
    font-family: var(--font-sans);
  }
  .zone {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .zone.left {
    padding-left: 14px;
    overflow: hidden;
  }
  /* The left zone is overflow-hidden with a fixed flex-basis in aligned mode, so a
     long branch name must not push the (rigid) limit bars out of view: let the git
     shrink and ellipsize first, and never shrink the bars. */
  .left-git {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
  }
  .zone.left :global(.limits) {
    flex: none;
  }
  /* The divider between the agents (left) and terminal (right) zones. */
  .zone.right {
    padding-left: 16px;
    padding-right: 14px;
    border-left: 1px solid var(--line-subtle);
  }
  /* Aligned mode: the left zone spans rail + agents so the divider (and right
     group) sits exactly at the terminal pane's left edge. `100%` is the footer
     width (== window width, since the footer has no horizontal padding). */
  .app-footer.aligned {
    justify-content: flex-start;
  }
  .app-footer.aligned .zone.left {
    flex: 0 0 calc(var(--rail-px) + var(--term-left) * (100% - var(--rail-px)));
  }
  .app-footer.aligned .zone.right {
    flex: 1 1 auto;
  }
  .sep {
    width: 1px;
    height: 14px;
    background: var(--line-subtle);
  }
  /* Cost + time-since-last-message metrics on the right zone. */
  .metric {
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-1);
    white-space: nowrap;
  }
  .metric.dim {
    color: var(--fg-4);
    font-weight: 500;
  }
</style>
