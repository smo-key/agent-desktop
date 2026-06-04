// A Svelte action that RELOCATES a persistent element into a target parent and
// restores it to its original DOM position on retarget/teardown. Used to teleport
// the single mounted workspace surface (all PaneNodes / PTYs) between the grid body
// and the inbox focus slot WITHOUT remounting it — moving where a terminal is shown
// never spawns or kills a PTY. A comment node marks the element's home position so
// `null` (or destroy) puts it back exactly where Svelte expects to remove it.
// Precondition: the element's original parent must stay attached to the document until the action is destroyed (it is the restore anchor's home).

export interface PortalAction {
  update(target: HTMLElement | null): void;
  destroy(): void;
}

export function portal(node: HTMLElement, target: HTMLElement | null): PortalAction {
  // Anchor the element's original location so we can return it precisely.
  const home = document.createComment('portal-home');
  node.before(home);

  function move(to: HTMLElement | null): void {
    if (to) {
      if (node.parentElement === to) return; // already there — don't re-append (avoids disrupting a live terminal)
      to.appendChild(node);
    } else {
      // Back home: re-insert right after the anchor comment.
      home.parentNode?.insertBefore(node, home.nextSibling);
    }
  }

  move(target);

  return {
    update(next: HTMLElement | null): void {
      move(next);
    },
    destroy(): void {
      // Restore home so Svelte removes the node from where it owns it, then drop
      // the anchor.
      home.parentNode?.insertBefore(node, home.nextSibling);
      home.remove();
    }
  };
}
