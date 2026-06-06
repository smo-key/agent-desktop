<script lang="ts">
  // The footer's project chip: the focused agent's project as a BRIGHT, solid
  // colored chip (the project's full color as the background, auto-contrast text
  // + icon on top) so it reads at a glance. When the project has a `logo` (a PNG
  // data URL), the logo image renders in place of the icon glyph. A neutral
  // "No project" chip shows when the focused pane has no project bound.
  import Icon from '$lib/icons/Icon.svelte';
  import { contrastText, projectLabel, type Project } from './projects';

  let { project }: { project: Project | null } = $props();
</script>

{#if project}
  {@const fg = contrastText(project.color)}
  <div class="chip" style:background={project.color} style:color={fg} title={project.path}>
    {#if project.logo}
      <img class="logo" src={project.logo} alt="" />
    {:else}
      <Icon name={project.icon} size={14} color={fg} stroke={2} />
    {/if}
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
  .logo {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: var(--r-xs);
    object-fit: cover;
    display: block;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
