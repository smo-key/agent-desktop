<script lang="ts">
  // The single persistent footer. LEFT (mirrors the rail + agent panes above):
  // the focused agent's project chip + the combined 5h/7d limit bars. RIGHT
  // (mirrors the terminal): the focused agent's git (statusline-style) then its
  // context bar. A divider separates the two zones. All math is in the pure,
  // tested `footerView`; this is the thin reactive shell that reads the stores.
  import { snapshots } from './snapshots.svelte';
  import { footerView } from './footerView';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import ProjectChip from '$lib/projects/ProjectChip.svelte';
  import LimitBars from './LimitBars.svelte';
  import GitInfo from './GitInfo.svelte';
  import ContextBar from './ContextBar.svelte';

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
</script>

<footer class="app-footer" aria-label="Status footer">
  <div class="zone left">
    <ProjectChip project={view.project} />
    <LimitBars fiveHour={view.fiveHour} sevenDay={view.sevenDay} />
  </div>

  <div class="zone right">
    <GitInfo git={view.git} />
    <span class="sep" aria-hidden="true"></span>
    <ContextBar pct={view.context} />
  </div>
</footer>

<style>
  .app-footer {
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 6px 14px;
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
  /* The divider between the agents (left) and terminal (right) zones. */
  .zone.right {
    padding-left: 16px;
    border-left: 1px solid var(--line-subtle);
  }
  .sep {
    width: 1px;
    height: 14px;
    background: var(--line-subtle);
  }
</style>
