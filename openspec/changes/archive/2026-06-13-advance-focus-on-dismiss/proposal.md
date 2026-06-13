## Why

When you dismiss the session you are looking at — archive it, pause it, or delete
it — the inbox does not reliably move you on to the next thing that needs you.
Today focus only advances via the opt-in auto-advance setting, which is OFF by
default, only triggers when an agent leaves attention *on its own*, only ever
targets Needs-you agents, and waits out a grace delay. An explicit dismiss is a
deliberate "I'm done here, what's next" gesture and should always carry you
forward, even with that setting off.

## What Changes

- On **archive**, **pause**, or **delete** of the **currently shown** session,
  focus immediately advances to the next actionable session:
  1. the first **Needs-you** session, else
  2. the first **In-flight** session, else
  3. the empty / "All clear" state.
- This advance is **immediate** (no grace delay) and **unconditional** — it
  ignores the `autoAdvance.enabled` setting ("regardless of my other settings").
- The dismissed session is **excluded** from the candidates, so archiving a
  waiting agent never re-selects itself.
- Scope guards: the advance fires **only** when the dismissed session is the one
  currently shown — archiving/pausing/deleting a *background* row never steals
  focus. Bulk "delete all archived" is unchanged.
- The existing opt-in auto-advance behavior (grace delay, setting gate,
  Needs-you-only target) is left exactly as-is; this is a separate, parallel path.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `inbox-auto-advance`: adds a requirement that an explicit dismiss (archive /
  pause / delete) of the currently shown session advances focus to the next
  actionable session — Needs-you, else In-flight, else All clear — immediately
  and regardless of the auto-advance setting.

## Impact

- `src/lib/overview/inbox.ts` — new pure selection helper `nextOnDismiss(rows, dismissedPaneId)`.
- `src/lib/overview/Inbox.svelte` — `archiveAgent`, `pauseAgent`, `deleteAgent`
  call a shared `advanceAfterDismiss` helper that uses `nextOnDismiss`.
- `src/lib/overview/inbox.test.ts` — unit tests for `nextOnDismiss`.
- `openspec/specs/inbox-auto-advance/spec.md` — new requirement + scenarios.
- No new dependencies; no breaking changes; no persisted-state or settings changes.
