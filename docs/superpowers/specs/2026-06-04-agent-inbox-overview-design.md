# Agent Inbox Overview — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorming) — ready for implementation plan
**Prototype:** `design/preview/overview-inbox-tui.html` (interactive; served locally during design)

## Problem

The current Overview is a wall of cards in three lanes (Needs attention / Completed /
In flight). Two problems:

1. **Cards-within-cards.** A pending `AskUserQuestion` renders as a bordered box
   (`.qask`) inside a bordered card (`.acard`), with bordered option buttons
   (`.qopt`) inside *that* — three nested surfaces for one decision.
2. **One treatment for two jobs.** Agents that need you and agents just running
   get the same card unit at different widths. Acting on what needs you means
   scanning cards; watching a specific agent means leaving the Overview for the grid.

We want the Overview to behave like an **inbox**: a single list of every agent on
the left, and a single **focus pane on the right** that shows the one agent you're
acting on — auto-filled from the attention queue, drained as you answer, empty when
you're caught up.

## Goals

- A master–detail **inbox**: left = grouped roster of all agents; right = one focus pane.
- The focus pane shows the agent's **live terminal (TUI)**, not a card — thin header,
  terminal in the middle, **no footer**. Entering an agent **auto-focuses its terminal
  and scrolls to the bottom**, so you type straight into the live session.
- **Attention queue with auto-advance:** the right auto-selects the first agent that
  needs you; resolving it advances to the next; when none remain (and you haven't
  opened anyone yourself) the right shows an **"All clear"** empty state.
- **Watch any agent:** clicking any roster row focuses that agent's live terminal in
  the same pane (a working agent you opened yourself stays focused until you pick
  another or it's cleared).
- Reuse the existing roster/event/title infrastructure and — critically — the
  **already-mounted terminal panes**; never double-spawn a PTY.

## Non-goals

- No change to how PTYs spawn, how usage/cost is computed, or the event pipeline.
- The full multi-pane **Grid** view stays as-is (reached via an "expand" affordance);
  the inbox does not try to replace split layouts.
- No new structured-answer widgets — you answer in the terminal itself (the TUI already
  renders `AskUserQuestion` / permission prompts).

## UX model

```
┌── Agents ──────────────┬───────────────────────────────────────────────┐
│ NEEDS YOU · 4          │  ◆ SKIPA-45: Fix auth redirect  needs you 1/4  │  ← thin header
│  ● SKIPA-45  Which se… │  ┌─────────────────────────────────────────┐  │
│  ● Dialog focus  On c… │  │  claude — ~/skipa/web        ● awaiting  │  │
│  ● Billing  Approval…  │  │                                          │  │
│  ● Migrate  Errored    │  │  (live terminal — auto-focused,          │  │  ← TUI, fills
│ IN FLIGHT · 3          │  │   scrolled to bottom; you type here)     │  │     the middle
│  ● Parser  ▸ editing…  │  │                                          │  │
│  ● CSV     ▸ tests…    │  │                                          │  │
│  ● Docs    ▸ reading…  │  └─────────────────────────────────────────┘  │  ← no footer
│ COMPLETED · 2          │                                                │
│  ● Bump deps  $0.91    │                                                │
│  ● Flaky test $0.43    │                                                │
└────────────────────────┴───────────────────────────────────────────────┘
```

**Left — grouped roster.** Sections **Needs you / In flight / Completed**, hairline
group headers. Each row: project icon, AI title (`titles`), a secondary line (the
pending question / `▸ current action` / `cost · age`), and a single **status circle**
(orange = needs you, pulsing blue = working, green = finished). No "act" pill — the
circle carries status. Click any row to focus it.

**Right — focus pane.** Three parts:
- **Thin header:** project icon · title · a state chip (`needs you · 1/4` while in the
  attention queue, `watching`, or `finished`) · ctx% · cost · queue nav (↑/↓ through the
  attention queue) · **⤢ expand to Grid**.
- **The live TUI** fills the rest. On entry it is **auto-focused** (a soft ring — orange
  when it needs you, blue when watching) and **scrolled to the bottom**.
- **No footer.** The terminal is the input surface.

**Selection logic (pure):**
- `focusAgent = userSelected ?? attentionQueue[0] ?? none`.
- `attentionQueue` = agents whose status is "needs you" (waiting / approval / error),
  in roster order, not yet addressed.
- Answering/addressing the focused agent removes it from the queue → the next queue
  item auto-fills the pane. Manually selecting a non-attention agent pins it as
  `userSelected` until it's deselected or another row is clicked.
- `none` → **All clear** empty panel.

## Architecture

The whole design hinges on one decision: **how the focus pane shows a *live* terminal
without re-spawning it.**

### Key facts (current code)

- `TerminalPane.svelte` spawns its own PTY on mount and kills it on destroy, keyed 1:1
  to `paneId`. Mounting a second copy of the same pane would double-spawn. (TerminalPane.svelte)
- The grid is **kept mounted at all times**: `+page.svelte` renders every workspace's
  `PaneNode`, hides inactive workspaces with `display:none`, and hides the entire grid
  (not unmount) while the Overview is active. Switching the active workspace / focused
  leaf is already a `display:none` swap that leaves xterm + PTY untouched.
  (`+page.svelte`, `PaneNode.svelte`)
- "Navigate to an agent" today = `setActiveWorkspace` + `setFocusIn` + `view.show('grid')`.

### Decision: one mounted terminal surface, teleported into the active view

There is exactly **one** mounted workspace surface (all `PaneNode`s / all PTYs), as
today. We **relocate that single surface element** into whichever view is active:

- **Grid view:** the surface fills the grid body (as today) — rail, splits, shortcuts.
- **Inbox view:** the surface is parented into the inbox's **right focus slot**.

The relocation is a small **portal action** (`use:portal={target}` that `appendChild`s a
persistent element into the active target). It runs on **view switch only** — an
infrequent, coarse event — never per keystroke or per selection.

Within the inbox, **selecting an agent does not remount anything**: it calls
`setActiveWorkspace(ws)` + `setFocusIn(ws, leaf)`, and the surface's existing
`display:none` machinery shows that agent's workspace and hides the rest. This is the
same mechanism the grid already uses, so watching/auto-advancing between agents reuses
proven, side-effect-free switching. The single-PTY invariant is preserved because there
is still only one mount per pane — we move where it's shown, never how many exist.

**Empty / All-clear:** when `focusAgent = none`, the focus slot shows the empty panel and
the surface is hidden (`display:none`), so no workspace is "active-visible" in the inbox.

**Auto-focus + scroll-to-bottom:** extend the terminal handle in `terminals.ts` with
`focus()` and `scrollToBottom()` (thin wrappers over xterm's `term.focus()` /
`term.scrollToBottom()`). On entering an agent, the inbox calls these on that pane's
handle on the next frame (after the `display` swap settles and `fit()` runs).

### Why not the alternatives

- **Mount a second TerminalPane in the focus pane** → double-spawns the PTY. Rejected.
- **Reparent the raw xterm host node directly on every selection** → fragile (Svelte
  owns those nodes) and runs on a hot path. The teleport happens only on view switch;
  selection stays a `display:none` swap, which the app already does safely.
- **Read-only transcript in the focus pane** → not a live TUI; fails the "type straight
  into the terminal" goal.

## Components & boundaries

- **`Inbox.svelte`** (replaces `Overview.svelte` as the overview surface): renders the
  left grouped roster + the right focus slot (header + portal target + empty panel).
  Thin reactive shell; all logic delegated to the cores below.
- **`inbox.ts` (pure):** `groupRoster(rows)` (reuse `groupByLane`), `attentionQueue(rows)`,
  `resolveFocus(rows, userSelected, addressed)`, `nextInQueue(...)`. Unit-tested.
- **`portal.ts`:** `portal(node, target)` Svelte action — relocates a persistent element
  into `target`; restores/cleans up on destroy or `target` change. Unit-tested with a
  jsdom container.
- **`terminals.ts`:** extend `TerminalHandle` with `focus()` + `scrollToBottom()`;
  register them from `TerminalPane.svelte`.
- **`view.svelte.ts`:** the overview mode now renders the inbox; the `⤢` expand sets
  `grid`. (ViewMode stays `overview | grid`.)
- Reused unchanged: `buildRoster`/`groupByLane`/`statusOf` (roster), `events` activity
  (status + `currentAction`), `titles` (AI titles), `activity` (transcript/messages),
  `snapshots`/`aggregate` (cost/ctx), `navigateTarget`.

## Data flow

1. `buildRoster(snapshots, workspaces, runtime, now, activity, _, events.activityMap())`
   → rows (unchanged).
2. `groupRoster(rows)` → the three left sections; `attentionQueue(rows)` → the queue.
3. `resolveFocus(rows, userSelected, addressed)` → the focused row (or none).
4. Focused row → `setActiveWorkspace` + `setFocusIn` (surface shows that pane) →
   `handle.focus()` + `handle.scrollToBottom()` next frame.
5. The agent leaving "needs you" (event-sourced status flips off waiting/error) removes
   it from the queue → step 3 re-resolves → next agent auto-fills.

## States & edge cases

- **No agents at all** → existing empty state ("Launch a mission").
- **Agents exist, none need you, none opened** → "All clear" in the focus pane; left list
  still shows In flight / Completed.
- **Focused attention agent exits / errors out** → re-resolve; if it errored it stays in
  the queue as an error until addressed (open terminal / dismiss).
- **User watching a working agent that finishes** → it moves to Completed in the list;
  the focus pane keeps showing it (now `finished`) until the user selects another.
- **Reduced motion** → status-circle pulse and ring transitions disabled (already handled).
- **Selection of an agent whose pane was closed** → `navigateTarget` returns null → fall
  back to attention queue / empty.

## Testing

- **Pure cores (vitest):** `attentionQueue` ordering; `resolveFocus` precedence
  (userSelected > queue > none); `nextInQueue` advance + wrap; `groupRoster` partition.
- **`portal` action (vitest + jsdom):** moves the node into the target; restores on
  destroy; re-targets when `target` changes.
- **`terminals` handle:** `focus()`/`scrollToBottom()` call through to the registered
  xterm wrappers (spy).
- **Scenario coverage:** add inbox scenarios to the agent-overview capability (snake_case
  scenario titles ↔ test names), keeping live-only behaviors (real PTY focus, teleport
  visual) in `MANUAL_SCENARIOS`.
- **Manual smoke:** answer an agent in the focus TUI → queue drains and advances; ⤢
  expands to grid with the same pane focused and live; "All clear" appears at inbox zero.

## Risks

- **Teleport correctness.** Moving the mounted surface between two parents must not
  remount PaneNodes (would respawn PTYs). Mitigation: relocate a *persistent* element via
  an `appendChild` portal that Svelte never re-creates; assert "no remount" by checking
  PTY spawn count across a view switch in the manual smoke. This is the one place to be
  careful and is called out for the plan.
- **Fit timing.** After a `display:none`→visible swap and teleport, the terminal must
  `fit()` before `scrollToBottom()`/`focus()`; reuse the existing `visible`/raf re-fit
  path in `TerminalPane`.

## Out of scope (now)

- Per-kind footers / structured-answer chips (we answer in the TUI).
- Multi-select / bulk actions in the roster.
- Reordering or custom grouping of the roster.
