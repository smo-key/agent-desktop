<script lang="ts">
  import TerminalPane from '$lib/TerminalPane.svelte';

  // The single Milestone-1 pane: one stable identity, one `claude` process in a
  // sensible cwd. Keying the pane on this stable id means future split/close/
  // reparent operations never remount the xterm instance (preserves scrollback
  // and the live PTY).
  const paneId = 'pane-1';
  const cwd = '/Users/arthur/git/agent-desktop';
</script>

<div class="app">
  <!-- Custom title bar. With macOS titleBarStyle "Overlay" the native traffic
       lights float over the left of this bar, so we pad-left to clear them and
       make the whole bar a drag region instead of drawing our own dots. -->
  <header class="titlebar" data-tauri-drag-region>
    <span class="title">agent-desktop</span>
    <span class="subtitle">{cwd}</span>
  </header>

  <main class="surface">
    {#key paneId}
      <TerminalPane {paneId} program="claude" {cwd} />
    {/key}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: #0d1117;
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    flex: 0 0 32px;
    padding: 0 12px 0 80px;
    background: #161b22;
    border-bottom: 1px solid #21262d;
    user-select: none;
    -webkit-user-select: none;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
    letter-spacing: -0.01em;
    pointer-events: none;
  }

  .subtitle {
    margin-left: auto;
    font-size: 11px;
    color: #6e7681;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
    pointer-events: none;
  }

  .surface {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    position: relative;
    background: #0d1117;
  }
</style>
