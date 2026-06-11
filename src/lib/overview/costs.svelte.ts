// Runes store for each agent's last known session cost, keyed by sessionId and
// persisted to localStorage. Mirrors the SummaryStore pattern (summaries.svelte.ts).
//
// WHY: snapshot.cost resets when a closed session is reopened with `claude --resume`
// (the new process starts fresh accounting). Recording costs while the session is live
// means the archived row keeps the correct total after reopening.
//
// The cache is keyed by the stable Claude sessionId so it survives restart/resume.

/** localStorage key for the persisted, sessionId-keyed cost cache. */
const STORAGE_KEY = 'agent-desktop:session-costs';

function loadPersisted(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Reactive cost store: sessionId -> last known cost in USD. Reading `costFor`
 * from a `$derived`/template tracks reactive state so archived rows re-render
 * when a cost is first recorded.
 */
export class CostStore {
  #bySession = $state<Record<string, number>>(loadPersisted());

  /** The cached cost for a session in USD, or null when none recorded. */
  costFor(sessionId: string | null | undefined): number | null {
    if (!sessionId) return null;
    return this.#bySession[sessionId] ?? null;
  }

  /**
   * Record a session's current cost. A positive, finite cost REPLACES the cached
   * value. Zero/null/non-finite is a no-op — we never blank out a previously
   * recorded cost (so a closed pane keeps the last real cost even if a later read
   * briefly reports zero at session start).
   */
  record(sessionId: string | null | undefined, cost: number | null | undefined): void {
    if (!sessionId) return;
    if (cost === null || cost === undefined || !Number.isFinite(cost) || cost <= 0) return;
    if (this.#bySession[sessionId] === cost) return;
    this.#bySession[sessionId] = cost;
    this.#persist();
  }

  #persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#bySession));
    } catch {
      /* ignore quota / disabled storage */
    }
  }
}

/** Singleton, imported by the inbox to record live costs + back the archived-row
 *  fallback. */
export const costs = new CostStore();
