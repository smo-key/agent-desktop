// Where the single mounted workspace surface should currently live. `null` means
// "home" — the grid body (visible only when the grid view is active). A non-null
// target is the inbox focus slot, into which the surface is teleported (see
// portal.ts). A thin singleton so the surface (in +page) and the inbox (which sets
// the target) coordinate without prop-drilling.

export class SurfaceSlot {
  /** The element the surface should be teleported into, or null for home. */
  target = $state<HTMLElement | null>(null);

  set(el: HTMLElement): void {
    this.target = el;
  }

  clear(): void {
    this.target = null;
  }
}

/** The singleton surface-slot store. */
export const surfaceSlot = new SurfaceSlot();
