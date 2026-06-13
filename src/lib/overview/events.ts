// PURE event-sourced activity for the agent-overview roster (activity-timeline).
//
// The backend event pipeline (events.rs) delivers each hook lifecycle event over
// a socket; the reactive `EventStore` (events.svelte.ts) accumulates them per
// pane and seeds from the `events_for` command. This framework-free core turns a
// pane's `AgentEvent[]` into the high-level `EventActivity` the roster consumes:
// a status, the current in-flight action label, and any pending question.
//
// Why events drive status (design D4): hooks fire deterministically on every
// turn/tool/notification, so they say precisely WHEN and WHAT KIND — unlike the
// PTY-byte heuristic (a coarse working/quiet guess) or the statusline snapshot
// (which stops re-rendering while claude waits). The roster prefers this status
// and falls back to the PTY heuristic only when a pane has produced no events.

import type { AgentStatus, PendingQuestion, QuestionOption } from './roster';

/** One normalized hook event, mirroring the JSON `events.rs` serializes. */
export interface AgentEvent {
  /** The frontend pane id (the store key / roster row). */
  paneId: string;
  /** The Claude session id (the durable-sink key). */
  sessionId: string;
  /** The hook lifecycle event name (e.g. `PreToolUse`, `Stop`). */
  hookEventName: string;
  /** Event time in unix millis. */
  ts: number;
  /** The tool name for Pre/PostToolUse events. */
  toolName?: string | null;
  /** A short activity label for Pre/PostToolUse events (e.g. `Bash:npm test`). */
  summary?: string | null;
  /** The structured pending-question payload on a `PreToolUse[AskUserQuestion]`. */
  question?: { questions?: unknown } | null;
  /** The message text on a `Notification` event. */
  notification?: string | null;
  /** The end reason on a `SessionEnd` event (`clear` / `logout` / `prompt_input_exit` /
   *  `other`). `clear` keeps the process alive (the conversation restarts), so it is not
   *  a finished session. */
  reason?: string | null;
  /** Frontend-only marker: a SYNTHETIC turn-end injected by `markInterrupt` (the user
   *  pressed Esc), NOT a real hook event. Never sent to Rust or the durable sink. Lets
   *  consumers (e.g. task auto-archive) distinguish a user interrupt from a genuine
   *  turn end. */
  synthetic?: boolean;
}

/** The high-level event-sourced activity for one pane (the roster's input). */
export interface EventActivity {
  /** Event-derived status, or null when events don't determine one (→ PTY fallback). */
  status: AgentStatus | null;
  /** The in-flight tool's label (latest PreToolUse with no matching PostToolUse), or null. */
  currentAction: string | null;
  /** A pending AskUserQuestion the agent is waiting on (compact text), or null. */
  question: string | null;
  /** The full structured pending question(s) the user can answer, or null. */
  questions: PendingQuestion[] | null;
  /** Whether this session has begun its FIRST turn — true once a `UserPromptSubmit`
   *  has ever been observed (the user typed, or an escalation was injected). A session
   *  with NONE is sitting at the freshly-launched prompt awaiting its first instruction.
   *  The roster reads this for the coordinator: a never-prompted coordinator is shown
   *  `waiting` (awaiting you), not the default `working` suppression. Absent ≡ false.
   *  NOTE: deriving this from the bounded ring ALONE is unsafe — a single long turn can
   *  emit >`EVENT_RING_CAP` events and EVICT the original `UserPromptSubmit`, which would
   *  wrongly flip a busy coordinator back to `waiting`. `EventStore` therefore keeps a
   *  durable per-pane latch and passes it as `stickyEverPrompted` to `deriveEventActivity`
   *  (see `events.svelte.ts` + `impliesEverPrompted`), so the signal survives eviction. */
  everPrompted?: boolean;
}

/** Max events retained per pane in the reactive store (mirrors the Rust ring cap). */
export const EVENT_RING_CAP = 500;

/** An empty activity (no events / nothing determined). */
const EMPTY: EventActivity = {
  status: null,
  currentAction: null,
  question: null,
  questions: null,
  everPrompted: false
};

/** PURE: coerce a raw `{questions:[...]}` payload into clean `PendingQuestion[]`, or
 *  null. Drops malformed entries; a question with no prompt text is skipped. */
export function normalizeQuestions(payload: unknown): PendingQuestion[] | null {
  const arr =
    payload && typeof payload === 'object' && Array.isArray((payload as { questions?: unknown }).questions)
      ? ((payload as { questions: unknown[] }).questions)
      : null;
  if (!arr) return null;
  const out: PendingQuestion[] = [];
  for (const q of arr) {
    if (!q || typeof q !== 'object') continue;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== 'string' || r.question.length === 0) continue;
    const options: QuestionOption[] = Array.isArray(r.options)
      ? (r.options as unknown[])
          .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
          .filter((o) => typeof o.label === 'string' && (o.label as string).length > 0)
          .map((o) => ({
            label: o.label as string,
            description: typeof o.description === 'string' ? (o.description as string) : ''
          }))
      : [];
    out.push({
      header: typeof r.header === 'string' ? r.header : '',
      question: r.question,
      multiSelect: r.multiSelect === true,
      options
    });
  }
  return out.length > 0 ? out : null;
}

/** The compact one-line form of the pending question(s) for the callout. */
function questionText(questions: PendingQuestion[]): string | null {
  const joined = questions
    .map((q) => q.question.trim())
    .filter((s) => s.length > 0)
    .join(' • ');
  return joined.length > 0 ? joined : null;
}

/**
 * PURE: derive a pane's event activity from its events (in arrival order).
 *
 * Status precedence (a dead process is handled by the roster, where PTY exit is
 * authoritative — this never returns `error`/`finished` from a crash):
 *  - a pending `AskUserQuestion` in flight        → `waiting` (+ the question)
 *  - any other tool in flight (Pre w/o its Post)  → `working` (+ currentAction)
 *  - last event `UserPromptSubmit`/`PostToolUse` → `working`
 *  - last event `Stop`                            → `waiting` (turn done, your move)
 *  - a `SubagentStop` is NOT a turn end for the host pane — an in-process Task
 *    subagent finished while the parent is still mid-turn. It neither clears the
 *    in-flight tool nor forces `waiting`; with a Task still in flight the parent stays
 *    `working`, and with nothing in flight it falls through to `null` (PTY fallback)
 *  - last event `Notification`                    → `waiting` (needs permission/input)
 *  - last event `SessionStart`                    → `waiting` — idle at the prompt
 *      (freshly started or just resumed), a STABLE status so it doesn't bounce
 *      with the idle TUI's redraws; it never reads "working" until you prompt it
 *  - last event `SessionEnd`                      → `finished`, EXCEPT reason `clear`
 *      (a `/clear` restarts the conversation in place) → `waiting` (idle at the prompt)
 *  - nothing determinable                         → `null` (roster falls back to PTY)
 *
 * `currentAction` is the latest PreToolUse summary with no matching PostToolUse,
 * cleared when that tool's PostToolUse or a turn-ending Stop arrives.
 */
export function deriveEventActivity(
  events: AgentEvent[],
  stickyEverPrompted = false
): EventActivity {
  if (events.length === 0) {
    return stickyEverPrompted ? { ...EMPTY, everPrompted: true } : EMPTY;
  }

  // Has this session ever started a turn? A `UserPromptSubmit` fires whenever a prompt
  // is submitted — typed by the user OR injected (e.g. an escalation to a coordinator).
  // Until one arrives the session is idle at the freshly-launched prompt (see the
  // coordinator handling in `roster.ts`). `stickyEverPrompted` is the store's durable
  // latch (events.svelte.ts): it survives the original prompt aging out of the bounded
  // ring during a long turn, so we OR it in rather than trusting the ring contents alone.
  const everPrompted =
    stickyEverPrompted || events.some((ev) => ev.hookEventName === 'UserPromptSubmit');

  // Track the in-flight tool: a PreToolUse clears on its PostToolUse or a turn end.
  // `SubagentStop` is deliberately NOT a clear: it fires on the PARENT pane when an
  // in-process Task subagent finishes, but the parent's `Task` tool has not returned
  // (its `PostToolUse[Task]` clears it) and the parent is still mid-turn — so it must
  // keep the parent's in-flight tool. The parent's own turn end stays its `Stop`.
  let inFlight: AgentEvent | null = null;
  for (const ev of events) {
    switch (ev.hookEventName) {
      case 'PreToolUse':
        inFlight = ev;
        break;
      case 'PostToolUse':
      case 'Stop':
        inFlight = null;
        break;
      default:
        break;
    }
  }

  const currentAction = inFlight?.summary ?? null;

  // A pending AskUserQuestion in flight → waiting, with the structured question.
  if (inFlight && inFlight.toolName === 'AskUserQuestion') {
    const questions = normalizeQuestions(inFlight.question);
    return {
      status: 'waiting',
      currentAction,
      question: questions ? questionText(questions) : null,
      questions,
      everPrompted
    };
  }

  // Any other tool in flight → working.
  if (inFlight) {
    return { status: 'working', currentAction, question: null, questions: null, everPrompted };
  }

  // No tool in flight: classify from the most recent event.
  const last = events[events.length - 1];
  let status: AgentStatus | null;
  switch (last.hookEventName) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      status = 'working';
      break;
    case 'Stop':
    case 'Notification':
    case 'SessionStart':
      // A session sitting at the prompt — freshly started with no prompt yet, or
      // resumed after a turn — is idle, AWAITING YOUR INPUT. Give it a STABLE
      // `waiting` rather than deferring to the PTY heuristic: claude's idle TUI
      // keeps redrawing (cursor blink, status line), so the PTY signal bounces
      // working↔waiting. An event-sourced status holds steady until you actually
      // submit a prompt (→ `UserPromptSubmit` → working).
      //
      // `SubagentStop` is intentionally ABSENT: it is not a turn end for the host
      // pane (a Task subagent finished, the parent is still working). With no tool in
      // flight it falls through to `null` (PTY fallback) rather than forcing `waiting`.
      status = 'waiting';
      break;
    case 'SessionEnd':
      // A `/clear` fires SessionEnd(reason:"clear") but the claude PROCESS continues (a
      // SessionStart follows), so it is idle at the freshly-cleared prompt — `waiting`,
      // NOT `finished`. A real end (logout / prompt-input-exit / other, or an unknown
      // reason from an older event) finishes.
      status = last.reason === 'clear' ? 'waiting' : 'finished';
      break;
    default:
      status = null;
  }
  return { status, currentAction: null, question: null, questions: null, everPrompted };
}

/** PURE: append an event to a pane's list, bounded to the ring cap (oldest dropped). */
export function appendBounded(list: AgentEvent[], ev: AgentEvent): AgentEvent[] {
  const next = [...list, ev];
  return next.length > EVENT_RING_CAP ? next.slice(next.length - EVENT_RING_CAP) : next;
}

/**
 * PURE: does this event PROVE the session has begun a turn? A `UserPromptSubmit` is the
 * direct signal, but any tool-use or turn-boundary event (`PreToolUse`/`PostToolUse`/
 * `Stop`/`SubagentStop`) also implies a turn ran — a session cannot run a tool or end a
 * turn without first being prompted. `EventStore` feeds BOTH live ingestion and seeded
 * history through this to set its sticky `everPrompted` latch, so the signal is robust
 * even after the original `UserPromptSubmit` has aged out of the bounded ring.
 */
export function impliesEverPrompted(ev: AgentEvent): boolean {
  switch (ev.hookEventName) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'Stop':
    case 'SubagentStop':
      return true;
    default:
      return false;
  }
}
