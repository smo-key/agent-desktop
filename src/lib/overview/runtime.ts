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

import type { PaneRuntime, RuntimeMap } from './roster';

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
 * Record whether Claude Code is ACTIVELY WORKING in this pane per a recent-terminal
 * indicator the event hooks miss (a foreground command running, or in-session
 * background work — see `detectTerminalBusy`). The TerminalPane recomputes this from
 * the live xterm tail on each output chunk; `rowFor` reads it (the same channel as
 * `exited`) to keep a live non-coordinator agent In flight rather than Needs input.
 * Cheap: a single field write. Leaving it unset is treated as "no indicator".
 */
export function noteBusy(paneId: string, busy: boolean): void {
  entryFor(paneId).terminalBusy = busy;
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
