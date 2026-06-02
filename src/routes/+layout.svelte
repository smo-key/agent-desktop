<script lang="ts">
  // xterm's base stylesheet is imported once for the whole app; individual
  // terminal panes only need to construct the addon/renderer.
  import '@xterm/xterm/css/xterm.css';

  let { children } = $props();
</script>

{@render children?.()}

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: #0a0a0a;
    color: #e6e6e6;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
</style>
