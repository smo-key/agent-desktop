<script lang="ts">
  // The footer's project chip: the focused agent's project as a BRIGHT, solid
  // colored chip (the project's full color as the background, auto-contrast text
  // + icon on top) so it reads at a glance. A neutral "No project" chip shows
  // when the focused pane has no project bound.
  import Icon from '$lib/icons/Icon.svelte';
  import { contrastText, projectLabel, type Project } from './projects';

  let { project }: { project: Project | null } = $props();
</script>

{#if project}
  {@const fg = contrastText(project.color)}
  <div class="chip" style:background={project.color} style:color={fg} title={project.path}>
    <Icon name={project.icon} size={14} color={fg} stroke={2} />
    <span class="name">{projectLabel(project)}</span>
  </div>
{:else}
  <div class="chip none" title="No project for the focused pane">
    <span class="name">No project</span>
  </div>
{/if}

<style>
  .chip {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 10px;
    border-radius: var(--r-full);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    max-width: 220px;
  }
  .chip.none {
    background: var(--space-700);
    color: var(--fg-3);
    font-weight: 500;
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
