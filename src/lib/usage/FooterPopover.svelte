<script lang="ts">
  // A reusable footer popover anchored ABOVE a trigger pill. Used by the
  // uncommitted-files commit popover (group 16), and shared with groups 17/18.
  //
  // Layout (mirrors BranchPicker's anchoring approach):
  //   - `position: fixed` panel placed just above the anchor element's top-left,
  //     computed from its bounding rect when `open` becomes true. Escapes
  //     overflow-hidden footer zones exactly like BranchPicker.
  //   - A full-screen transparent scrim sits behind the panel at a lower z-index
  //     and closes the popover on outside-click.
  //   - Pressing Escape closes the popover.
  //
  // Content is injected via Svelte 5 snippet props:
  //   title?   — optional header line above the scrollable body
  //   body     — the scrollable content area (file list, etc.)
  //   action   — pinned button area at the bottom of the panel (always visible)
  //
  // The panel uses a flex-column layout so the body scrolls while the action
  // stays pinned at the bottom: `body` has `flex: 1 1 auto; overflow-y: auto`
  // and `action` has `flex: 0 0 auto`.

  import type { Snippet } from 'svelte';
  import { autofocus } from '$lib/ui/autofocus';

  let {
    open,
    anchor = null,
    onClose,
    title,
    body,
    action
  }: {
    /** Whether the popover is visible. */
    open: boolean;
    /** The trigger element to anchor to. Position is computed on open from its
     *  bounding rect — the same approach as BranchPicker. */
    anchor?: HTMLElement | null;
    /** Close callback — invoked on outside-click or Escape. */
    onClose: () => void;
    /** Optional header rendered above the scrollable body. */
    title?: Snippet;
    /** The scrollable list / content area. */
    body: Snippet;
    /** The pinned primary-action area (stays visible while the body scrolls). */
    action: Snippet;
  } = $props();

  // ── Fixed panel position (measured from the anchor on open) ──────────────
  let panelLeft = $state(0);
  let panelBottom = $state(0);

  // Re-measure the anchor position whenever the popover opens so the panel sits
  // just above the trigger pill, mirroring BranchPicker's `rect` logic.
  $effect(() => {
    if (!open) return;
    const rect = anchor?.getBoundingClientRect();
    if (rect) {
      panelLeft = rect.left;
      panelBottom = window.innerHeight - rect.top + 6;
    }
  });

  // ── Keyboard handler ──────────────────────────────────────────────────────
  // Bound at the window level (see <svelte:window> below) so Escape closes the
  // popover regardless of where focus is. On open the body autofocuses its first
  // focusable row (use:autofocus within), but the body may have no focusable row
  // (empty/loading) so focus can sit outside the panel — a panel-local handler
  // alone wouldn't suffice. Guarded by `open` so closed instances are inert.
  function onKeyDown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if open}
  <!-- Full-screen transparent scrim: outside click closes the popover.
       Same pattern as BranchPicker. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="fp-scrim" role="presentation" onclick={onClose}></div>

  <!-- Panel — stops click propagation so it doesn't hit the scrim. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fp-panel"
    style:left={`${panelLeft}px`}
    style:bottom={`${panelBottom}px`}
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    {#if title}
      <div class="fp-title">
        {@render title()}
      </div>
    {/if}

    <!-- Autofocus the body (not the whole panel) so focus lands on the first
         navigational row and NEVER on the pinned action button below — a stray
         Enter must not fire a consequential commit/push. When the body has no
         focusable row (empty/loading, or a non-GitHub push list), nothing is
         focused and focus stays on the trigger. -->
    <div class="fp-body" use:autofocus={{ within: true }}>
      {@render body()}
    </div>

    <div class="fp-action">
      {@render action()}
    </div>
  </div>
{/if}

<style>
  /* Full-screen transparent scrim: sits behind the panel and catches
     outside-clicks to close the popover, mirroring BranchPicker. */
  .fp-scrim {
    position: fixed;
    inset: 0;
    z-index: 3000;
  }

  /* Fixed panel positioned just above the trigger pill. Mirrors BranchPicker's
     `.bp-menu` — fixed to escape footer overflow:hidden zones, z-index above
     the scrim, consistent visual style. Flex-column so the body can scroll while
     the action area stays pinned at the bottom. */
  .fp-panel {
    position: fixed;
    z-index: 3001;
    min-width: 260px;
    max-width: 420px;
    /* Max height caps the scrollable area; the action is outside the scroll. */
    display: flex;
    flex-direction: column;
    background: var(--space-700);
    border: 1px solid var(--line-default);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }

  /* Optional title header — rendered above the scrollable body. */
  .fp-title {
    flex: 0 0 auto;
    padding: 10px 12px 6px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-4);
    border-bottom: 1px solid var(--line-subtle);
    user-select: none;
    -webkit-user-select: none;
  }

  /* The scrollable content area: grows to fill available space, scrolls when
     content overflows. max-height caps how tall the list can grow before it
     starts scrolling. */
  .fp-body {
    flex: 1 1 auto;
    max-height: 260px;
    overflow-y: auto;
    padding: 5px 0;
  }

  /* The pinned action area: always visible at the bottom of the panel, even
     while the body scrolls. A top border visually separates it from the list. */
  .fp-action {
    flex: 0 0 auto;
    padding: 8px 10px;
    border-top: 1px solid var(--line-subtle);
  }
</style>
