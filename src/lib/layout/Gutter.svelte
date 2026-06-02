<script lang="ts">
  // A 6px draggable bar that sits between two adjacent children of a Split.
  // It captures the pointer, tracks the pixel delta along the split's main
  // axis, converts that to a `deltaRatio` against the CONTAINER's pixel size
  // (so the ratio math matches the flex layout exactly), and calls the store's
  // `resize(splitId, gutterIndex, deltaRatio)`. Updates are rAF-throttled, and
  // the store's `dragging` flag is raised for the whole drag so panes can defer
  // their xterm `fit()` until drag-end (avoids reflow churn mid-drag).

  import { workspace } from './workspace.svelte';
  import type { Direction } from './tree';

  let {
    /** Which workspace this gutter's Split lives in. */
    workspaceId,
    /** The Split whose gutter this is. */
    splitId,
    /** Index `i` of the gutter (between children i and i+1). */
    gutterIndex,
    /** Split direction: 'row' => horizontal drag, 'col' => vertical drag. */
    direction,
    /**
     * The flex container element (the Split's own element). Used to measure the
     * pixel size of the axis we're dragging along, for px -> ratio conversion.
     */
    container
  }: {
    workspaceId: string;
    splitId: string;
    gutterIndex: number;
    direction: Direction;
    container: HTMLElement | null;
  } = $props();

  // Drag bookkeeping. `start*` is the pointer origin; `lastDelta` is the most
  // recent ratio delta we COMMITTED, so each rAF applies the *incremental*
  // change against the live tree (resizeAdjacent is relative).
  let active = $state(false);
  let startPos = 0;
  let containerPx = 1;
  let committedDelta = 0;
  let pendingDelta = 0;
  let rafId = 0;

  function axisPos(e: PointerEvent): number {
    return direction === 'row' ? e.clientX : e.clientY;
  }

  function flush() {
    rafId = 0;
    // Apply only the *increment* since the last commit; resizeAdjacent mutates
    // the live ratios relatively, so we must not re-apply the whole delta.
    const inc = pendingDelta - committedDelta;
    if (inc !== 0) {
      workspace.resizeIn(workspaceId, splitId, gutterIndex, inc);
      committedDelta = pendingDelta;
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();
    active = true;
    startPos = axisPos(e);
    const rect = container.getBoundingClientRect();
    containerPx = (direction === 'row' ? rect.width : rect.height) || 1;
    committedDelta = 0;
    pendingDelta = 0;
    workspace.setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!active) return;
    const deltaPx = axisPos(e) - startPos;
    pendingDelta = deltaPx / containerPx;
    // rAF-throttle: at most one resize commit per frame.
    if (rafId === 0) rafId = requestAnimationFrame(flush);
  }

  function endDrag(e: PointerEvent) {
    if (!active) return;
    active = false;
    // Final flush so the last frame's delta isn't dropped.
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    flush();
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released; ignore.
    }
    workspace.setDragging(false);
  }
</script>

<!-- The gutter intercepts pointer events; clicks here must NOT bubble up to the
     pane focus handler. touch-action:none keeps the browser from scrolling/zooming
     during a touch drag. -->
<div
  class="gutter"
  class:active
  class:row={direction === 'row'}
  class:col={direction === 'col'}
  role="separator"
  aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
></div>

<style>
  .gutter {
    flex: 0 0 6px;
    position: relative;
    background: #161b22;
    touch-action: none;
    z-index: 2;
  }

  .gutter.row {
    cursor: col-resize;
    width: 6px;
  }

  .gutter.col {
    cursor: row-resize;
    height: 6px;
  }

  /* A thin centered hairline so the gutter reads as a divider, plus a wider
     invisible hit area via ::before for easier grabbing. */
  .gutter::after {
    content: '';
    position: absolute;
    background: #21262d;
  }
  .gutter.row::after {
    top: 0;
    bottom: 0;
    left: 2px;
    width: 1px;
  }
  .gutter.col::after {
    left: 0;
    right: 0;
    top: 2px;
    height: 1px;
  }

  .gutter::before {
    content: '';
    position: absolute;
  }
  .gutter.row::before {
    top: 0;
    bottom: 0;
    left: -3px;
    right: -3px;
  }
  .gutter.col::before {
    left: 0;
    right: 0;
    top: -3px;
    bottom: -3px;
  }

  .gutter:hover::after,
  .gutter.active::after {
    background: #58a6ff;
  }
</style>
