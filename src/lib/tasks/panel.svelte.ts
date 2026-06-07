// Reactive UI state for the Terminals panel's show/hide toggle. Kept separate from
// the terminal CONTENT store (projectTerminals) so toggling visibility never
// touches process state: the panel chrome stays mounted and is hidden via CSS, so
// running PTYs survive a hide (terminals-panel spec). Open state is in-memory
// (defaults off); the running processes — not the panel's visibility — are the
// durable thing worth persisting.

/** Docked-panel width bounds (px). */
const MIN_WIDTH = 260;
const MAX_WIDTH = 1000;
const DEFAULT_WIDTH = 380;
const WIDTH_KEY = 'agent-desktop:terminals-width';

function clampWidth(px: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
}

function loadWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_WIDTH;
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v > 0 ? clampWidth(v) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export class TasksPanelUI {
  /** Whether the right-docked panel is currently shown. */
  open = $state(false);

  /** The docked panel width in px (drag-resizable, persisted across restarts). */
  width = $state(loadWidth());

  /** Toggle the panel on/off. */
  toggle(): void {
    this.open = !this.open;
  }

  /** Set the panel width (clamped to [MIN,MAX]) and persist the choice. */
  setWidth(px: number): void {
    this.width = clampWidth(px);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(WIDTH_KEY, String(this.width));
      } catch {
        /* ignore quota / disabled storage */
      }
    }
  }
}

/** The singleton Terminals-panel UI store. */
export const tasksPanel = new TasksPanelUI();
