<script lang="ts">
  // Main-pane EMPTY STATE for a not-started project COORDINATOR (add-agent-
  // specialists, task 10.4). Shown in the inbox focus pane when the
  // `coordinator-start:<projectId>` sentinel is selected (the project has no live
  // coordinator). A heading + explanation + a single Start button that launches the
  // orchestrator via the existing `startCoordinator` path. Mirrors the inbox's other
  // main-pane empty states (`.empty`) for styling.
  import { startCoordinator } from './coordinator.svelte';
  import type { Project } from '../projects/projects';

  interface Props {
    /** The project whose coordinator this Start state launches. */
    project: Project;
    /** Called with the launched coordinator's paneId so the inbox can focus it. */
    onStarted: (paneId: string) => void;
  }
  let { project, onStarted }: Props = $props();

  let starting = $state(false);

  async function start() {
    if (starting) return;
    starting = true;
    try {
      const paneId = await startCoordinator(project);
      if (paneId) onStarted(paneId);
    } finally {
      starting = false;
    }
  }
</script>

<div class="empty">
  <div class="ring"><span class="glyph">⛭</span></div>
  <h3>Start the coordinator</h3>
  <p>
    The <strong>{project.name}</strong> coordinator orchestrates other agents for this
    project — give it a goal and it plans, spawns, and coordinates specialists to carry
    it out. It isn't running yet.
  </p>
  <button type="button" class="btn-primary" onclick={start} disabled={starting}>
    {starting ? 'Starting…' : 'Start coordinator'}
  </button>
</div>

<style>
  /* Mirrors the inbox's main-pane empty states (.empty). */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    text-align: center;
    padding: 40px;
  }
  .empty .ring {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--orange-tint);
    color: var(--orange-200);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 30px;
  }
  .empty h3 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 18px;
    margin: 0;
    color: var(--fg-1);
  }
  .empty p {
    margin: 0;
    font-size: 13.5px;
    color: var(--fg-3);
    max-width: 360px;
    line-height: 1.5;
  }
  .empty p strong {
    color: var(--fg-2);
    font-weight: 600;
  }
  .btn-primary {
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 13px;
    color: #fff;
    background: var(--blue-500);
    border: none;
    border-radius: var(--r-md);
    padding: 9px 15px;
    cursor: pointer;
    margin-top: 4px;
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
