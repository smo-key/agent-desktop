<script lang="ts">
  // Recursive, self-referencing renderer for the pane tree.
  //   - A Leaf renders a single `TerminalPane`, KEYED on its stable `paneId`
  //     (`{#key node.paneId}`) so split/close/collapse never remounts it. The
  //     leaf reports its on-screen rect (for directional focus), forwards
  //     clicks to focus, and shows a 1px accent ring when focused. Its
  //     `active` prop (WebGL on/off) is driven by whether it is the focused leaf.
  //   - A Split renders a flexbox row/col; each child cell is `flex:0 0 ratio%`
  //     with a `Gutter` between adjacent children. The Split element is passed
  //     to each Gutter as the measurement container for px -> ratio conversion.

  import TerminalPane from '$lib/TerminalPane.svelte';
  import TaskBadge from '$lib/usage/TaskBadge.svelte';
  import Gutter from './Gutter.svelte';
  import PaneNode from './PaneNode.svelte';
  import { workspace } from './workspace.svelte';
  import { setRect, clearRect } from './rects.svelte';
  import { buildPaneMenu } from './paneMenu';
  import { contextMenu } from './contextmenu.svelte';
  import { getTerminal } from './terminals';
  import { leavesInOrder, type Node } from './tree';
  import { launcher } from '$lib/launcher/launcherStore.svelte';

  let {
    node,
    /** Which workspace this subtree belongs to. Resolves session/focus per-ws. */
    workspaceId,
    /**
     * Whether this subtree's workspace is the active (visible) one. Only the
     * active workspace's focused leaf gets a WebGL context (context ceiling),
     * and only the active workspace publishes/uses pane rects for directional
     * focus. Inactive workspaces stay fully mounted (PTY + xterm alive) but
     * hidden by the parent's `display:none`.
     */
    activeWorkspace
  }: { node: Node; workspaceId: string; activeWorkspace: boolean } = $props();

  // The Split element, handed to child Gutters so they can measure the axis px.
  let splitEl: HTMLDivElement | null = $state(null);

  // ---- Leaf-only view geometry / lifecycle (rect reporting) ----------------
  let leafEl: HTMLDivElement | null = $state(null);

  const isLeaf = $derived(node.type === 'leaf');
  // For a leaf: is THIS leaf the focused one IN ITS workspace? Drives the ring.
  const focused = $derived(
    isLeaf && node.id === workspace.focusedIdIn(workspaceId)
  );
  // WebGL is loaded only for the focused leaf OF THE ACTIVE workspace, so hidden
  // workspaces' panes drop to the DOM renderer and free their GL contexts.
  const webglActive = $derived(focused && activeWorkspace);
  // The spawn params for this leaf's pane, from this workspace's registry.
  const session = $derived(
    node.type === 'leaf' ? workspace.sessionIn(workspaceId, node.paneId) : null
  );

  // Publish the leaf's pixel rect into the shared map so directional focus can
  // pick spatial neighbors. Only the active workspace publishes — hidden
  // workspaces have 0×0 / stale geometry and must not pollute the rect map that
  // drives directional focus (which only ever targets the active workspace).
  // Re-measure on resize; clear on unmount or when the workspace goes inactive.
  $effect(() => {
    if (node.type !== 'leaf' || !leafEl || !activeWorkspace) return;
    const id = node.id;
    const el = leafEl;
    const publish = () => {
      const r = el.getBoundingClientRect();
      setRect(id, { x: r.x, y: r.y, width: r.width, height: r.height });
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearRect(id);
    };
  });

  function focusThis() {
    if (node.type === 'leaf') workspace.setFocusIn(workspaceId, node.id);
  }

  // Right-click a leaf: focus it (also activates its workspace, so split/close
  // act on it), then open the pane context menu at the cursor.
  function openMenu(e: MouseEvent) {
    if (node.type !== 'leaf') return;
    e.preventDefault();
    workspace.setFocusIn(workspaceId, node.id);
    const handle = getTerminal(node.paneId);
    const canClose = leavesInOrder(workspace.root).length > 1;
    const sections = buildPaneMenu({
      split: (dir, where) => workspace.split(dir, where),
      close: () => workspace.closeFocused(),
      newSession: () => launcher.show(),
      copy: () => {
        const sel = handle?.getSelection() ?? '';
        if (sel) void navigator.clipboard?.writeText(sel).catch(() => {});
      },
      paste: () => {
        void navigator.clipboard
          ?.readText()
          .then((t) => handle?.paste(t))
          .catch(() => {});
      },
      canClose,
      hasSelection: handle?.hasSelection() ?? false
    });
    contextMenu.show(e.clientX, e.clientY, sections);
  }
</script>

{#if node.type === 'leaf'}
  <!-- A leaf cell. Click anywhere (including the xterm surface, via bubbling)
       focuses it; the focused leaf gets the accent ring + WebGL. -->
  <div
    class="leaf"
    class:focused
    bind:this={leafEl}
    role="presentation"
    onpointerdown={focusThis}
    oncontextmenu={openMenu}
  >
    {#key node.paneId}
      <TerminalPane
        paneId={node.paneId}
        program={session?.program ?? '/bin/zsh'}
        cwd={session?.cwd ?? null}
        initialInput={session?.initialInput}
        active={webglActive}
        deferFit={activeWorkspace && workspace.dragging}
        visible={activeWorkspace}
      />
    {/key}
    <!-- Subtle top-right task badge for this pane (pointer-events:none; hides when
         there's no task). Reads the same per-pane snapshot the dashboard uses. -->
    <TaskBadge paneId={node.paneId} />
  </div>
{:else}
  <!-- A split. Flex row/col; each child is flex:0 0 ratio% with gutters between.
       The element is the measurement container for its gutters. -->
  <div
    class="split"
    class:row={node.direction === 'row'}
    class:col={node.direction === 'col'}
    bind:this={splitEl}
  >
    {#each node.children as child, i (child.id)}
      <div class="cell" style="flex: 0 0 {node.ratios[i] * 100}%;">
        <PaneNode node={child} {workspaceId} {activeWorkspace} />
      </div>
      {#if i < node.children.length - 1}
        <Gutter
          {workspaceId}
          splitId={node.id}
          gutterIndex={i}
          direction={node.direction}
          container={splitEl}
        />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .leaf {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    /* A 1px inset ring; transparent until focused so layout never shifts. */
    box-shadow: inset 0 0 0 1px transparent;
    transition: box-shadow 0.1s ease;
  }
  .leaf.focused {
    box-shadow: inset 0 0 0 1px #58a6ff;
    z-index: 1;
  }

  .split {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .split.row {
    flex-direction: row;
  }
  .split.col {
    flex-direction: column;
  }

  .cell {
    position: relative;
    /* min-*:0 lets flex children shrink below content size, so ratios drive the
       layout rather than xterm's intrinsic size. */
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
