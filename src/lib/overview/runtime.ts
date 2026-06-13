// Imperative per-pane RUNTIME registry: the live PTY-activity + process-exit
// state the agent-overview roster derives each agent's status from. TerminalPane
// updates it as the source of truth for the actual terminal — `noteOutput` on
// every PTY data chunk, `noteExit` when the child exits, `clearRuntime` on
// teardown. The Overview reads `runtimeMap()` on its 1-second clock and feeds it
// to `buildRoster` / `deriveStatus`.
//
// Deliberately NOT reactive — like `layout/terminals.ts`, it is a side-channel of
// imperative state, not UI state. Per-byte reactive writes would be wasteful; the
// Overview's existing heartbeat clock drives recomputation instead, so a status
// change is reflected within ~1s with zero per-chunk reactivity cost.

import type { AgentStatus, PaneRuntime, RuntimeMap } from './roster';

const runtimes = new Map<string, PaneRuntime>();

/** Ensure (and return) the runtime entry for a pane, created alive with no output. */
function entryFor(paneId: string): PaneRuntime {
  let r = runtimes.get(paneId);
  if (!r) {
    r = { lastOutputAt: null, exited: false, exitCode: null };
    runtimes.set(paneId, r);
  }
  return r;
}

/**
 * Record that a pane's PTY produced output at `nowMs` (epoch ms). Marks the pane
 * alive (an exited pane that somehow emits late output is no longer "exited") and
 * stamps `lastOutputAt`. Cheap: a single field write on every data chunk.
 */
export function noteOutput(paneId: string, nowMs: number): void {
  const r = entryFor(paneId);
  r.lastOutputAt = nowMs;
  // Output after an "exit" would be contradictory; keep the alive state coherent.
  r.exited = false;
  r.exitCode = null;
}

/** Record that a pane's process exited with `code` (null when unknown). */
export function noteExit(paneId: string, code: number | null): void {
  const r = entryFor(paneId);
  r.exited = true;
  r.exitCode = code;
}

/**
 * Record an active-work observation for this pane — a recent-terminal indicator the
 * event hooks miss (a foreground command running, or in-session background work —
 * see `detectTerminalBusy`). The TerminalPane recomputes the indicator from the live
 * xterm tail on each output chunk and calls this with the result and the current
 * time. A POSITIVE detection stamps `terminalBusyAt = nowMs`; a NEGATIVE detection
 * leaves the timestamp UNCHANGED, so the In-flight override (`rowFor`) holds through
 * the redrawing TUI's flicker and lapses only after `BUSY_GRACE_MS` of no detection
 * (see `BUSY_GRACE_MS`). Cheap: at most a single field write. Never observed → unset
 * → treated as "no indicator" (fail-safe).
 */
export function noteBusy(paneId: string, busy: boolean, nowMs: number): void {
  if (busy) entryFor(paneId).terminalBusyAt = nowMs;
}

/**
 * Record a pane's most recent DERIVED (final) status — the hysteresis memory for the
 * silence-based demotion. The Overview calls this for each row after every roster
 * rebuild; `deriveStatus` reads it back (via `runtime.lastStatus`, as `prevStatus`) so a
 * pane already shown `working` holds In flight through a brief silence rather than
 * bouncing to `waiting` (see `IDLE_GRACE_MS`). Cheap: a single field write.
 *
 * Records ONLY when a runtime entry already exists — it must NEVER create one. A pane
 * with no entry derives `idle` ("not wired yet"); fabricating an entry here would make
 * the next tick read its null `lastOutputAt` as `working`, flipping a just-spawned,
 * zero-output pane from idle to working. A genuinely working/quiet pane always has an
 * entry (from `noteOutput`), so the hysteresis memory is preserved where it matters.
 */
export function noteStatus(paneId: string, status: AgentStatus): void {
  const r = runtimes.get(paneId);
  if (r) r.lastStatus = status;
}

/** Drop a pane's runtime entry (on pane teardown), so a closed pane leaves none. */
export function clearRuntime(paneId: string): void {
  runtimes.delete(paneId);
}

/** The current runtime entry for a pane, or undefined when none. */
export function getRuntime(paneId: string): PaneRuntime | undefined {
  return runtimes.get(paneId);
}

/**
 * A plain snapshot of the whole registry (`pane_id -> runtime`) for `buildRoster`.
 * Returns SHALLOW COPIES of each entry so a later mutation can't retroactively
 * change a roster the caller already derived.
 */
export function runtimeMap(): RuntimeMap {
  const out: RuntimeMap = {};
  for (const [id, r] of runtimes) out[id] = { ...r };
  return out;
}
