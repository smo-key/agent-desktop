## Context

The inbox focus pane shows ONE agent at a time, resolved by `resolveFocus` (the
user's explicit pin, else the first Needs-you agent, else none). A reconcile
`$effect` in `Inbox.svelte` keeps the shown agent in sync and implements the
opt-in **auto-advance**: when a focused agent leaves attention on its own, and
the `autoAdvance.enabled` setting is ON, focus advances after a grace delay to
the next Needs-you agent (spec: `inbox-auto-advance`).

That path does not serve the explicit-dismiss case. Archiving, pausing, or
deleting the session you are looking at is a deliberate "next, please" gesture,
but today it only moves focus if the auto-advance setting is on and the timing/
transition heuristics happen to fire — and even then only ever toward Needs-you,
never an In-flight session.

Relevant pure cores (framework-free, unit-tested) live in
`src/lib/overview/inbox.ts`: `attentionQueue`, `resolveFocus`, `nextInQueue`.
Lane membership comes from `roster.ts`: `laneForRow(row)` returns `'flight'` for
an in-flight (working/idle, not paused/closed/preview) agent; `needsAttention`
backs the attention queue. `viewRows` in `Inbox.svelte` is already lane-grouped
and within-lane ordered, so "first in the list" is just the first matching row.

## Goals / Non-Goals

**Goals:**

- On archive / pause / delete of the **currently shown** session, immediately
  advance focus: first Needs-you, else first In-flight, else All clear.
- Make the advance unconditional (ignores `autoAdvance.enabled`) and immediate
  (no grace delay).
- Keep the selection logic in a pure, unit-tested helper.

**Non-Goals:**

- No change to the existing opt-in auto-advance (its grace delay, setting gate,
  and Needs-you-only target are untouched).
- No change to bulk "delete all archived".
- No new settings, persisted state, or dependencies.

## Decisions

**1. A new pure helper `nextOnDismiss(rows, dismissedPaneId)` rather than reusing
`resolveFocus`.** `resolveFocus` only targets the attention queue; the dismiss
case needs an In-flight fallback and must exclude the dismissed pane. A dedicated
helper keeps both selection rules pure and independently testable, and leaves
`resolveFocus`'s contract (used by the reconcile effect) unchanged.

```ts
export function nextOnDismiss(rows: AgentRow[], dismissedPaneId: string): string | null {
  const others = rows.filter((r) => r.paneId !== dismissedPaneId);
  const attn = attentionQueue(others)[0];
  if (attn) return attn.paneId;
  const flight = others.find((r) => laneForRow(r) === 'flight');
  return flight?.paneId ?? null;
}
```

Alternative considered: extend `resolveFocus` with an In-flight fallback. Rejected
— it would change auto-advance/first-focus behavior (which intentionally goes to
All clear, not an In-flight agent, when nothing needs you) and broaden a shared
contract for a single caller.

**2. Drive the advance from the explicit gesture handlers, not the reconcile
effect.** `archiveAgent`, `pauseAgent`, and `deleteAgent` call a shared
`advanceAfterDismiss(paneId)` that runs only when `paneId === shownId`. Doing it
in the handler (not the effect) makes it inherently immediate and independent of
`autoAdvance.enabled`, and keeps the effect's transition/grace logic for the
separate opt-in path untouched.

```ts
function advanceAfterDismiss(paneId: string) {
  if (shownId !== paneId) return;     // only the shown session
  clearAdvance();                     // cancel any pending grace timer
  userSelected = null;
  shownId = nextOnDismiss(viewRows, paneId);
  focusNonce += 1;                    // re-focus the target terminal
}
```

It is called **before** the `workspace.*` mutation so `viewRows` is the
pre-mutation roster; `nextOnDismiss` excludes the dismissed pane regardless, so
the other rows (whose lanes do not change) are scanned correctly.

**3. Compatibility with the reconcile effect.** After the handler sets
`shownId` to the target (a still-existing pane or `null`) and `userSelected =
null`, the effect re-runs: it finds the target row (so the "shown agent closed"
immediate-switch branch does not mis-fire), sees `resolveFocus` wants the same
pane (or null), and leaves focus put. The explicit jump therefore wins and is not
overridden. When the target is `null`, the effect resolves to `null` too (no
attention agent) and the All clear state holds.

## Risks / Trade-offs

- **[Stale `viewRows` at call time]** → `nextOnDismiss` excludes the dismissed
  pane and reads only other rows, whose lanes are unaffected by dismissing this
  one; computing before the mutation avoids any reliance on synchronous
  re-derivation.
- **[Effect overriding the explicit target]** → mitigated by setting `shownId`
  to a still-existing target so the effect's null/closed branch does not run and
  `resolveFocus` returns the same pane (analyzed in Decision 3). Covered by the
  spec scenarios; verified manually in-app.
- **[In-flight target then immediately needs input]** → acceptable: it is still
  an actionable session and matches "switch to the first one in the list."
