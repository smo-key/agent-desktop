// A Svelte action that gives any element a single, body-portaled, styled hint —
// the app-wide tooltip system. Replaces native `title=` (slow, OS-styled) and the
// old hand-rolled inline `.pp-tip` spans. One shared popup element is reused across
// every instance (only one tooltip is ever visible) and lives directly under
// <body>, so it is never clipped by an `overflow:hidden` ancestor the way an inline
// absolute span would be (git pills, task rows, the rail all sit in clipped boxes).
//
//   <button use:tooltip={'Launch agent'} aria-label="Launch agent">…</button>
//   <button use:tooltip={{ text: 'Collapse projects', placement: 'right' }}>…</button>
//
// `aria-label` stays the accessibility source of truth — the popup is aria-hidden,
// purely a visual hint. Shows after a short delay on hover, instantly on KEYBOARD
// focus (a focus that follows a pointer press, i.e. a click, is suppressed). Hides
// on leave, blur, click, or Escape. Styled to match the dark popover look via the
// shared design tokens (those are :root vars, so they reach the body-level popup).

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipOptions {
  text: string;
  placement?: TooltipPlacement;
  /** Hover delay in ms before the hint appears. Keyboard focus ignores this. */
  delay?: number;
}

export type TooltipParam = string | TooltipOptions;

export interface TooltipAction {
  update(param: TooltipParam): void;
  destroy(): void;
}

const HOVER_DELAY = 300;
const GAP = 8; // px between the element and its hint

interface Resolved {
  text: string;
  placement: TooltipPlacement;
  delay: number;
}

function normalize(param: TooltipParam): Resolved {
  const o = typeof param === 'string' ? { text: param } : param;
  return {
    text: o.text ?? '',
    placement: o.placement ?? 'top',
    delay: o.delay ?? HOVER_DELAY
  };
}

// ── shared singleton popup ────────────────────────────────────────────────────
let popupEl: HTMLElement | null = null;
let currentOwner: HTMLElement | null = null; // node whose hint is showing
let styleInjected = false;

function injectStyle(): void {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const style = document.createElement('style');
  style.dataset.tooltip = '';
  style.textContent = `
.tt-pop {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
  max-width: 320px;
  padding: 4px 9px;
  white-space: nowrap;
  background: var(--space-700);
  border: 1px solid var(--line-default);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow-pop);
  color: var(--fg-1);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-fast, 120ms) ease;
}
.tt-pop.tt-show { opacity: 1; }`;
  document.head.appendChild(style);
}

function ensurePopup(): HTMLElement {
  injectStyle();
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.className = 'tt-pop';
    popupEl.setAttribute('role', 'tooltip');
    popupEl.setAttribute('aria-hidden', 'true');
  }
  return popupEl;
}

function place(node: HTMLElement, placement: TooltipPlacement, el: HTMLElement): void {
  const r = node.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight;

  // Flip if the preferred side has no room.
  let p = placement;
  if (p === 'top' && r.top - h - GAP < 0) p = 'bottom';
  else if (p === 'bottom' && r.bottom + h + GAP > vh) p = 'top';
  else if (p === 'left' && r.left - w - GAP < 0) p = 'right';
  else if (p === 'right' && r.right + w + GAP > vw) p = 'left';

  let top = 0;
  let left = 0;
  switch (p) {
    case 'top':
      top = r.top - h - GAP;
      left = r.left + r.width / 2 - w / 2;
      break;
    case 'bottom':
      top = r.bottom + GAP;
      left = r.left + r.width / 2 - w / 2;
      break;
    case 'left':
      left = r.left - w - GAP;
      top = r.top + r.height / 2 - h / 2;
      break;
    case 'right':
      left = r.right + GAP;
      top = r.top + r.height / 2 - h / 2;
      break;
  }

  // Keep it on screen.
  left = Math.max(4, Math.min(left, vw - w - 4));
  top = Math.max(4, Math.min(top, vh - h - 4));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.dataset.placement = p;
}

export function tooltip(node: HTMLElement, param: TooltipParam): TooltipAction {
  let opts = normalize(param);
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerArmed = false; // a pointer press just happened — suppress the focus-show

  function clearTimer(): void {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function show(): void {
    clearTimer();
    if (!opts.text) return;
    const el = ensurePopup();
    el.textContent = opts.text;
    el.classList.remove('tt-show');
    document.body.appendChild(el);
    place(node, opts.placement, el);
    currentOwner = node;
    // Next frame so the opacity transition runs (no-op cost if rAF is absent).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (currentOwner === node) el.classList.add('tt-show');
      });
    } else {
      el.classList.add('tt-show');
    }
  }

  function hide(): void {
    clearTimer();
    if (popupEl && currentOwner === node) {
      popupEl.classList.remove('tt-show');
      popupEl.remove();
      currentOwner = null;
    }
  }

  const onEnter = (): void => {
    clearTimer();
    showTimer = setTimeout(show, opts.delay);
  };
  const onLeave = (): void => {
    pointerArmed = false;
    hide();
  };
  const onPointerDown = (): void => {
    pointerArmed = true;
    hide();
  };
  const onFocusIn = (): void => {
    if (pointerArmed) {
      pointerArmed = false; // consumed — this focus came from a click
      return;
    }
    show();
  };
  const onFocusOut = (): void => hide();
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') hide();
  };

  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('focusin', onFocusIn);
  node.addEventListener('focusout', onFocusOut);
  node.addEventListener('keydown', onKeyDown);

  return {
    update(next: TooltipParam): void {
      opts = normalize(next);
      // Retarget a hint that is currently visible for this node.
      if (popupEl && currentOwner === node) {
        popupEl.textContent = opts.text;
        place(node, opts.placement, popupEl);
      }
    },
    destroy(): void {
      hide();
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('focusout', onFocusOut);
      node.removeEventListener('keydown', onKeyDown);
    }
  };
}
