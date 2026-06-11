// Runes store for each agent's LAST assistant message, keyed by sessionId and
// persisted to localStorage. Mirrors the TitleStore persistence pattern
// (`titles.svelte.ts`): a durable `#bySession` map seeded from localStorage and
// re-persisted on every write.
//
// WHY: the roster sub-line shows an agent's last message/question for EVERY row,
// including ARCHIVED (closed) ones. A closed pane's PTY is terminated, so its LIVE
// transcript activity (`AgentRow.summary`) is unavailable — the row would otherwise
// have no last message to show. While a pane is live we record its `summary` here;
// when it is later closed (live activity gone) the roster falls back to the cached
// summary so an archived row still shows the last thing the agent said.
//
// The cache is keyed by the stable, app-owned Claude `sessionId` (resolved by the
// caller exactly as the title cache is — `workspace.sessionIn(...).sessionId`), so it
// survives restart/resume: a restored agent reads the same sessionId and its cached
// last message is still there.

/** localStorage key for the persisted, sessionId-keyed last-summary cache. */
const STORAGE_KEY = 'agent-desktop:session-summaries';

/** Load the persisted sessionId -> last-summary cache (survives restart / resume). */
function loadPersisted(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Reactive last-summary store: sessionId -> last non-empty assistant message. Reading
 * `summaryFor` from a `$derived`/template tracks the reactive `#bySession` state so the
 * roster re-renders when an archived row's fallback summary is first recorded.
 */
export class SummaryStore {
  // The DURABLE cache, keyed by sessionId (stable across restart/resume), loaded from
  // localStorage on construct. Reactive so a freshly recorded summary updates any row
  // reading it. Held as a single $state record (mirrors TitleStore.byPane).
  #bySession = $state<Record<string, string>>(loadPersisted());

  /** The cached last assistant message for a session, or null when none recorded. */
  summaryFor(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return this.#bySession[sessionId] ?? null;
  }

  /**
   * Record a session's latest assistant message. A non-empty summary REPLACES the
   * cached one (the latest message wins) and persists it under `sessionId`. An
   * empty/whitespace summary or a null sessionId is a no-op — we never blank out a
   * previously recorded message (so a closed pane keeps its last real message even if
   * a later poll briefly reports an empty summary).
   */
  record(sessionId: string | null | undefined, summary: string | null | undefined): void {
    if (!sessionId) return;
    const trimmed = summary?.trim();
    if (!trimmed) return; // never clear a recorded last message with an empty one
    if (this.#bySession[sessionId] === trimmed) return; // unchanged — skip the write
    this.#bySession[sessionId] = trimmed;
    this.#persist();
  }

  /** Write the durable sessionId-keyed cache to localStorage (best-effort). */
  #persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#bySession));
    } catch {
      /* ignore quota / disabled storage */
    }
  }
}

/** Singleton, imported by the inbox to record live summaries + back the archived-row
 *  fallback. */
export const summaries = new SummaryStore();
