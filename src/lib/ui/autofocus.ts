// A Svelte action that moves keyboard focus to a dialog's first control the
// moment it opens. Our dialogs are `{#if open}`-mounted, so the action's mount
// IS the open — `node.focus()` then lands focus without a separate effect.
//
//   <button use:autofocus>Cancel</button>          // focus this element
//   <div class="panel" use:autofocus={{ within: true }}>…</div>  // focus its first control
//
// Prefer this over the native `autofocus` attribute: it carries no
// `a11y_autofocus` lint (so no per-use ignore comment) and supports the
// `within` mode needed by containers whose controls come from snippets/children
// (e.g. FooterPopover), where the focus target is a descendant, not the node.

export interface AutofocusOptions {
  /** Focus the first focusable DESCENDANT instead of the node itself. Use on a
   *  container whose interactive controls are provided by children / snippets. */
  within?: boolean;
  /** When false, the action is inert — no focus. Lets a caller focus just one
   *  element of a rendered list, e.g. `use:autofocus={{ enabled: i === 0 }}`. */
  enabled?: boolean;
}

export interface AutofocusAction {
  destroy(): void;
}

// Tab-reachable controls, in the order the browser would visit them. Excludes
// `tabindex="-1"` (programmatic-only) and disabled controls.
const FOCUSABLE =
  'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),' +
  'button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export function autofocus(node: HTMLElement, param?: AutofocusOptions): AutofocusAction {
  if (param?.enabled === false) return { destroy() {} };

  const target = param?.within ? node.querySelector<HTMLElement>(FOCUSABLE) : node;
  // No focusable descendant (e.g. a loading/empty popover body) → leave focus be
  // rather than trapping it on a non-interactive container.
  target?.focus();

  return {
    destroy() {}
  };
}
