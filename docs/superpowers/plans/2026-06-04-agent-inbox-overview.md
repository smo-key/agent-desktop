# Agent Inbox Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lane-of-cards Overview with a master–detail **inbox** — a grouped roster on the left and a single focus pane on the right that shows the selected agent's *live* terminal (auto-focused, scrolled to bottom, no footer), with attention agents auto-filling the focus and draining as they're addressed.

**Architecture:** There is exactly one mounted workspace surface (all `PaneNode`s / all PTYs), as today. A **portal action** relocates that single surface element into whichever view is active — the grid body, or the inbox's right focus slot — on view switch only. Within the inbox, selecting an agent is just `setActiveWorkspace` + `setFocusIn` (the existing `display:none` workspace swap), so no PTY is ever double-spawned. All selection logic is pure and unit-tested; the component is a thin reactive shell.

**Tech Stack:** SvelteKit / Svelte 5 (runes), TypeScript, xterm.js, Tauri. Tests: vitest (+ jsdom). Gate: `svelte-check` (0/0) + `tools/check-scenario-coverage.mjs` + `openspec validate --strict`.

**Design spec:** `docs/superpowers/specs/2026-06-04-agent-inbox-overview-design.md`
**Interactive prototype:** `design/preview/overview-inbox-tui.html`

---

## File structure

**Create:**
- `src/lib/layout/portal.ts` — `portal(node, target)` Svelte action; relocates a persistent element into `target`, restores on destroy/retarget.
- `src/lib/layout/portal.test.ts` — jsdom tests for the action.
- `src/lib/layout/surfaceSlot.svelte.ts` — tiny runes store holding the current teleport target (`HTMLElement | null`).
- `src/lib/layout/surfaceSlot.test.ts` — set/clear test.
- `src/lib/overview/inbox.ts` — PURE inbox cores: `isAttention`, `attentionQueue`, `resolveFocus`, `nextInQueue`, `shouldClearPin`.
- `src/lib/overview/inbox.test.ts` — unit tests for the cores (names match the spec scenarios).
- `src/lib/overview/Inbox.svelte` — the inbox surface (left grouped roster + right focus slot + empty panel).

**Modify:**
- `src/lib/layout/terminals.ts` — add `focus()` + `scrollToBottom()` to `TerminalHandle`; add `focusTerminal(paneId)` + `scrollTerminalToBottom(paneId)` helpers.
- `src/lib/layout/terminals.test.ts` — (create if absent) register-and-call test for the new helpers.
- `src/lib/TerminalPane.svelte` — register `focus`/`scrollToBottom` in the handle.
- `src/routes/+page.svelte` — `use:portal` on the workspace surface; render `<Inbox />` for the overview; default the surface home to the grid body.
- `openspec/changes/add-agent-desktop/specs/agent-overview/spec.md` — replace the card/lanes requirement with the inbox master–detail requirement + scenarios.
- `tools/check-scenario-coverage.mjs` — add the live-only inbox scenarios to `MANUAL_SCENARIOS` for `agent-overview`.

**Delete (last, after the inbox renders):**
- `src/lib/overview/Overview.svelte` — superseded by `Inbox.svelte`. (Its pure cores — `roster.ts`, `message.ts`, `navigate.ts`, `usage.ts`, `answer.ts` — stay; only the card component goes.)

---

## Task 1: Portal action

Moves a persistent DOM element into a target parent and restores it on teardown. This is the primitive that teleports the workspace surface between the grid and the inbox focus slot without remounting it.

**Files:**
- Create: `src/lib/layout/portal.ts`
- Test: `src/lib/layout/portal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/layout/portal.test.ts
import { describe, expect, it } from 'vitest';
import { portal } from './portal';

function setup() {
  const home = document.createElement('div');
  const node = document.createElement('section');
  node.textContent = 'surface';
  home.appendChild(node);
  const target = document.createElement('div');
  document.body.append(home, target);
  return { home, node, target };
}

describe('portal action', () => {
  it('moves the node into the target on mount', () => {
    const { node, target } = setup();
    portal(node, target);
    expect(node.parentElement).toBe(target);
  });

  it('returns the node home when the target becomes null', () => {
    const { home, node, target } = setup();
    const action = portal(node, target);
    expect(node.parentElement).toBe(target);
    action.update(null);
    expect(node.parentElement).toBe(home);
  });

  it('re-targets when the target changes', () => {
    const { node, target } = setup();
    const other = document.createElement('div');
    document.body.appendChild(other);
    const action = portal(node, target);
    action.update(other);
    expect(node.parentElement).toBe(other);
  });

  it('restores the node to its home parent on destroy', () => {
    const { home, node, target } = setup();
    const action = portal(node, target);
    action.destroy();
    expect(node.parentElement).toBe(home);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layout/portal.test.ts`
Expected: FAIL — `Cannot find module './portal'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/layout/portal.ts
// A Svelte action that RELOCATES a persistent element into a target parent and
// restores it to its original DOM position on retarget/teardown. Used to teleport
// the single mounted workspace surface (all PaneNodes / PTYs) between the grid body
// and the inbox focus slot WITHOUT remounting it — moving where a terminal is shown
// never spawns or kills a PTY. A comment node marks the element's home position so
// `null` (or destroy) puts it back exactly where Svelte expects to remove it.

export interface PortalAction {
  update(target: HTMLElement | null): void;
  destroy(): void;
}

export function portal(node: HTMLElement, target: HTMLElement | null): PortalAction {
  // Anchor the element's original location so we can return it precisely.
  const home = document.createComment('portal-home');
  node.before(home);

  function move(to: HTMLElement | null): void {
    if (to) {
      to.appendChild(node);
    } else {
      // Back home: re-insert right after the anchor comment.
      home.parentNode?.insertBefore(node, home.nextSibling);
    }
  }

  move(target);

  return {
    update(next: HTMLElement | null): void {
      move(next);
    },
    destroy(): void {
      // Restore home so Svelte removes the node from where it owns it, then drop
      // the anchor.
      home.parentNode?.insertBefore(node, home.nextSibling);
      home.remove();
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layout/portal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout/portal.ts src/lib/layout/portal.test.ts
git commit -m "feat(layout): portal action to relocate a persistent element"
```

---

## Task 2: Surface-slot store

A one-field runes store that holds the current teleport target. The inbox sets it to its focus slot (or `null` for "home / hidden"); `+page.svelte` feeds it into the surface's `portal` action.

**Files:**
- Create: `src/lib/layout/surfaceSlot.svelte.ts`
- Test: `src/lib/layout/surfaceSlot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/layout/surfaceSlot.test.ts
import { describe, expect, it } from 'vitest';
import { SurfaceSlot } from './surfaceSlot.svelte';

describe('SurfaceSlot', () => {
  it('starts with no target', () => {
    expect(new SurfaceSlot().target).toBe(null);
  });

  it('set() points the target at an element; clear() resets it', () => {
    const slot = new SurfaceSlot();
    const el = document.createElement('div');
    slot.set(el);
    expect(slot.target).toBe(el);
    slot.clear();
    expect(slot.target).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layout/surfaceSlot.test.ts`
Expected: FAIL — `Cannot find module './surfaceSlot.svelte'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/layout/surfaceSlot.svelte.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layout/surfaceSlot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout/surfaceSlot.svelte.ts src/lib/layout/surfaceSlot.test.ts
git commit -m "feat(layout): surface-slot store for the teleport target"
```

---

## Task 3: Terminal focus + scroll-to-bottom helpers

Extend the terminal registry so the inbox can focus a pane's xterm and pin it to the bottom when you enter that agent.

**Files:**
- Modify: `src/lib/layout/terminals.ts`
- Test: `src/lib/layout/terminals.test.ts` (create)
- Modify: `src/lib/TerminalPane.svelte:344-378` (the `registerTerminal({...})` handle)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/layout/terminals.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerTerminal,
  unregisterTerminal,
  focusTerminal,
  scrollTerminalToBottom,
  type TerminalHandle
} from './terminals';

function fakeHandle(over: Partial<TerminalHandle> = {}): TerminalHandle {
  return {
    getSelection: () => '',
    hasSelection: () => false,
    paste: () => {},
    send: () => true,
    sendKeys: () => true,
    focus: () => {},
    scrollToBottom: () => {},
    ...over
  };
}

afterEach(() => {
  unregisterTerminal('p1');
});

describe('terminal focus/scroll helpers', () => {
  it('focusTerminal calls focus() on the registered handle', () => {
    const focus = vi.fn();
    registerTerminal('p1', fakeHandle({ focus }));
    focusTerminal('p1');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('scrollTerminalToBottom calls scrollToBottom() on the registered handle', () => {
    const scrollToBottom = vi.fn();
    registerTerminal('p1', fakeHandle({ scrollToBottom }));
    scrollTerminalToBottom('p1');
    expect(scrollToBottom).toHaveBeenCalledOnce();
  });

  it('is a no-op for an unknown pane (never throws)', () => {
    expect(() => focusTerminal('nope')).not.toThrow();
    expect(() => scrollTerminalToBottom('nope')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/layout/terminals.test.ts`
Expected: FAIL — `focusTerminal` / `scrollTerminalToBottom` are not exported, and `TerminalHandle` has no `focus`/`scrollToBottom`.

- [ ] **Step 3: Add the handle methods + helpers**

In `src/lib/layout/terminals.ts`, add two methods to the `TerminalHandle` interface (after `sendKeys`):

```ts
  /**
   * Focus this pane's xterm so keystrokes go straight to its PTY. Called when the
   * inbox makes this agent the focused one, so you type into the live terminal
   * without a separate input box.
   */
  focus(): void;
  /**
   * Scroll this pane's xterm viewport to the bottom (the live prompt). Called
   * alongside focus() on entry so you land on the latest output.
   */
  scrollToBottom(): void;
```

Then add the lookup helpers at the end of the file (after `getTerminal`):

```ts
/** Focus a pane's terminal if it is registered (no-op otherwise). */
export function focusTerminal(paneId: string): void {
  handles.get(paneId)?.focus();
}

/** Scroll a pane's terminal to the bottom if it is registered (no-op otherwise). */
export function scrollTerminalToBottom(paneId: string): void {
  handles.get(paneId)?.scrollToBottom();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/layout/terminals.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the methods from TerminalPane**

In `src/lib/TerminalPane.svelte`, inside the `registerTerminal(paneId, { ... })` object (ends at line ~377, after `sendKeys`), add:

```ts
        // Inbox: focus this pane's xterm so typing goes straight to the PTY, and
        // pin the viewport to the live prompt on entry.
        focus: () => {
          term?.focus();
        },
        scrollToBottom: () => {
          term?.scrollToBottom();
        }
```

(Insert a comma after the `sendKeys` method's closing brace so the object stays valid.)

- [ ] **Step 6: Verify the build is clean**

Run: `npm run check`
Expected: `svelte-check` reports 0 errors / 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/lib/layout/terminals.ts src/lib/layout/terminals.test.ts src/lib/TerminalPane.svelte
git commit -m "feat(terminals): focus() + scrollToBottom() handle methods and helpers"
```

---

## Task 4: Pure inbox cores

All the selection logic, framework-free and unit-tested. Test titles match the agent-overview scenarios added in Task 7.

**Files:**
- Create: `src/lib/overview/inbox.ts`
- Test: `src/lib/overview/inbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/overview/inbox.test.ts
import { describe, expect, it } from 'vitest';
import type { AgentRow, AgentStatus } from './roster';
import {
  isAttention,
  attentionQueue,
  resolveFocus,
  nextInQueue,
  shouldClearPin
} from './inbox';

// Minimal AgentRow factory — only the fields the inbox cores read.
function row(paneId: string, status: AgentStatus): AgentRow {
  return {
    paneId,
    workspaceId: 'w-' + paneId,
    name: paneId,
    cwd: null,
    model: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    status,
    projectId: null
  };
}

describe('isAttention', () => {
  it('treats waiting and error as needing attention', () => {
    expect(isAttention('waiting')).toBe(true);
    expect(isAttention('error')).toBe(true);
    expect(isAttention('working')).toBe(false);
    expect(isAttention('finished')).toBe(false);
    expect(isAttention('idle')).toBe(false);
  });
});

describe('Attention queue surfaces waiting and errored agents', () => {
  it('keeps roster order and includes only waiting/error rows', () => {
    const rows = [
      row('a', 'working'),
      row('b', 'waiting'),
      row('c', 'finished'),
      row('d', 'error')
    ];
    expect(attentionQueue(rows).map((r) => r.paneId)).toEqual(['b', 'd']);
  });
});

describe('Focus resolves to the user selection before the queue', () => {
  it('returns the user-selected row when it still exists', () => {
    const rows = [row('a', 'waiting'), row('b', 'working')];
    expect(resolveFocus(rows, 'b')?.paneId).toBe('b');
  });
});

describe('Focus falls back to the attention queue when nothing is selected', () => {
  it('returns the first attention row when there is no selection', () => {
    const rows = [row('a', 'working'), row('b', 'waiting'), row('c', 'error')];
    expect(resolveFocus(rows, null)?.paneId).toBe('b');
  });

  it('falls back to the queue when the selected pane is gone', () => {
    const rows = [row('a', 'waiting')];
    expect(resolveFocus(rows, 'missing')?.paneId).toBe('a');
  });
});

describe('Focus is empty when nothing needs attention and nothing is selected', () => {
  it('returns null', () => {
    const rows = [row('a', 'working'), row('b', 'finished')];
    expect(resolveFocus(rows, null)).toBe(null);
  });
});

describe('Queue navigation steps through waiting agents', () => {
  it('advances to the next attention row and wraps', () => {
    const rows = [row('a', 'waiting'), row('b', 'error'), row('c', 'waiting')];
    expect(nextInQueue(rows, 'a', 1)).toBe('b');
    expect(nextInQueue(rows, 'c', 1)).toBe('a');
    expect(nextInQueue(rows, 'b', -1)).toBe('a');
  });

  it('returns null when the queue is empty', () => {
    expect(nextInQueue([row('a', 'working')], 'a', 1)).toBe(null);
  });
});

describe('Addressed attention agent advances the focus to the next', () => {
  it('clears the pin when the pinned agent leaves attention', () => {
    // pinned 'a' transitions waiting -> working: pin should clear so the queue takes over
    expect(shouldClearPin('waiting', 'working', true)).toBe(true);
  });

  it('keeps the pin while the agent still needs attention', () => {
    expect(shouldClearPin('waiting', 'waiting', true)).toBe(false);
    expect(shouldClearPin('error', 'waiting', true)).toBe(false);
  });

  it('does nothing when the agent was not pinned', () => {
    expect(shouldClearPin('waiting', 'working', false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/overview/inbox.test.ts`
Expected: FAIL — `Cannot find module './inbox'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/overview/inbox.ts
// PURE selection cores for the inbox overview (design 2026-06-04). The focus pane
// shows ONE agent: the user's explicit selection if any, else the first agent that
// needs attention, else none ("All clear"). Addressing the focused attention agent
// (it transitions out of the attention status) advances the focus to the next in
// the queue. Framework-free so it is trivially unit-tested; Inbox.svelte is the
// thin reactive shell that feeds it the live roster and renders the result.

import type { AgentRow, AgentStatus } from './roster';

/** Whether a status means the agent is waiting on YOU (waiting or errored). */
export function isAttention(status: AgentStatus): boolean {
  return status === 'waiting' || status === 'error';
}

/**
 * The attention queue: every agent that needs you, in roster order. These are the
 * rows the focus pane auto-fills from (top first) and drains as each is addressed.
 */
export function attentionQueue(rows: AgentRow[]): AgentRow[] {
  return rows.filter((r) => isAttention(r.status));
}

/**
 * The focused agent for the right pane:
 *   1. the user's explicit selection, if that pane still exists in the roster;
 *   2. else the first agent in the attention queue;
 *   3. else null ("All clear").
 */
export function resolveFocus(rows: AgentRow[], userSelected: string | null): AgentRow | null {
  if (userSelected) {
    const picked = rows.find((r) => r.paneId === userSelected);
    if (picked) return picked;
  }
  return attentionQueue(rows)[0] ?? null;
}

/**
 * Step through the attention queue from `currentPaneId` by `dir` (+1 / -1),
 * wrapping around. Returns the next attention pane id, or null when the queue is
 * empty. Used by the focus header's ↑/↓ queue-nav.
 */
export function nextInQueue(
  rows: AgentRow[],
  currentPaneId: string | null,
  dir: 1 | -1
): string | null {
  const q = attentionQueue(rows);
  if (q.length === 0) return null;
  const i = q.findIndex((r) => r.paneId === currentPaneId);
  const base = i < 0 ? 0 : i;
  const next = (base + dir + q.length) % q.length;
  return q[next].paneId;
}

/**
 * Whether to drop the user's pin on the focused agent: it WAS pinned, it used to
 * need attention, and it no longer does (you addressed it). Dropping the pin lets
 * `resolveFocus` advance to the next agent in the queue — "addressing one moves to
 * the next". A non-pinned agent, or one still needing attention, keeps its state.
 */
export function shouldClearPin(
  prev: AgentStatus,
  next: AgentStatus,
  isPinned: boolean
): boolean {
  return isPinned && isAttention(prev) && !isAttention(next);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/overview/inbox.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/overview/inbox.ts src/lib/overview/inbox.test.ts
git commit -m "feat(overview): pure inbox selection cores (queue/resolve/nav/pin)"
```

---

## Task 5: The Inbox component

The new overview surface: a grouped roster on the left, a focus pane on the right that teleports in the live terminal of the selected agent (or shows "All clear"). This is the largest task; the code below is complete.

**Files:**
- Create: `src/lib/overview/Inbox.svelte`

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/overview/Inbox.svelte -->
<script lang="ts">
  // The INBOX — the primary overview surface (replaces the lane-of-cards
  // Overview). Left: a grouped roster of every agent (Needs you / In flight /
  // Completed), each a row with a status circle. Right: a single focus pane —
  // a thin header, then the SELECTED agent's live terminal (auto-focused +
  // scrolled to bottom; no footer), or an "All clear" panel when nothing needs
  // you and nothing is open.
  //
  // The live terminal is NOT re-mounted here: the single mounted workspace
  // surface (all PaneNodes/PTYs, owned by +page) is teleported into `focusSlot`
  // via surfaceSlot + the portal action. Selecting an agent is just
  // setActiveWorkspace + setFocusIn — the existing display:none workspace swap —
  // so no PTY is ever double-spawned. All selection logic is pure (inbox.ts).

  import { tick } from 'svelte';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import { surfaceSlot } from '$lib/layout/surfaceSlot.svelte';
  import { focusTerminal, scrollTerminalToBottom } from '$lib/layout/terminals';
  import {
    buildRoster,
    groupByLane,
    LANE_ORDER,
    type AgentLane,
    type AgentRow,
    type AgentStatus
  } from './roster';
  import { isAttention, attentionQueue, resolveFocus, nextInQueue, shouldClearPin } from './inbox';
  import { toRosterWorkspaces, toNavWorkspaces } from './rosterInputs';
  import { runtimeMap } from './runtime';
  import { aggregate } from './usage';
  import { navigateTarget } from './navigate';
  import { activity } from './activity.svelte';
  import { events } from './events.svelte';
  import { titles } from './titles.svelte';
  import { view } from './view.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { filterRowsByProject } from '$lib/projects/projectRollup';
  import { projectForId } from '$lib/projects/projects';
  import ProjectPanel from '$lib/projects/ProjectPanel.svelte';
  import ProjectIcon from '$lib/icons/ProjectIcon.svelte';

  // 1-second clock so working -> waiting flips as the PTY goes quiet (matches the
  // old Overview). Epoch ms to match the runtime registry.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(id);
  });

  const rosterWorkspaces = $derived(toRosterWorkspaces(workspace.workspaces));
  const navWorkspaces = $derived(toNavWorkspaces(workspace.workspaces));

  const allRows = $derived(
    buildRoster(
      snapshots.byPane,
      rosterWorkspaces,
      runtimeMap(),
      nowMs,
      activity.bySession,
      undefined,
      events.activityMap()
    )
  );
  const rows = $derived(filterRowsByProject(allRows, projectFilter.selected));

  const grouped = $derived(groupByLane(rows));
  const queue = $derived(attentionQueue(rows));
  const attnCount = $derived(queue.length);

  const subagentCosts = $derived([] as { cost: number | null }[]);
  const totals = $derived(aggregate(rows, subagentCosts));

  // Group metadata (label + glyph) for the left list, in attn -> flight -> done order.
  const LANES: Record<AgentLane, { title: string; glyph: string }> = {
    attn: { title: 'Needs you', glyph: '!' },
    flight: { title: 'In flight', glyph: '▸' },
    done: { title: 'Completed', glyph: '✓' }
  };

  // The user's explicit selection (a watched agent), or null to let the queue drive.
  let userSelected = $state<string | null>(null);

  // The focused agent (pure): user selection > attention queue > none.
  const focus = $derived(resolveFocus(rows, userSelected));

  // Drive the live surface from the focused agent: activate its workspace + focus
  // its leaf (the existing display:none swap), then point the teleport target at
  // our focus slot. With no focus, clear the target so the surface goes home
  // (hidden) and the empty panel shows. Also auto-focus the terminal + scroll to
  // bottom on entry.
  let focusSlot = $state<HTMLDivElement | null>(null);
  let lastFocusId: string | null = null;
  let lastFocusStatus: AgentStatus | null = null;

  $effect(() => {
    const f = focus;
    if (!f || !focusSlot) {
      surfaceSlot.clear();
      lastFocusId = null;
      lastFocusStatus = null;
      return;
    }
    // Address-advance: if the pinned agent just left attention, drop the pin so
    // resolveFocus moves to the next in the queue on the next pass.
    if (
      lastFocusId === f.paneId &&
      lastFocusStatus !== null &&
      shouldClearPin(lastFocusStatus, f.status, userSelected === f.paneId)
    ) {
      userSelected = null;
    }

    // Point the surface at this agent's workspace/leaf and teleport it into the slot.
    const target = navigateTarget(navWorkspaces, f.paneId);
    if (target) {
      workspace.setActiveWorkspace(target.workspaceId);
      workspace.setFocusIn(target.workspaceId, target.leafId);
    }
    surfaceSlot.set(focusSlot);

    // On ENTRY to a new agent, focus its terminal + pin to the bottom (after the
    // display swap + fit settle).
    if (lastFocusId !== f.paneId) {
      const id = f.paneId;
      void tick().then(() =>
        requestAnimationFrame(() => {
          scrollTerminalToBottom(id);
          focusTerminal(id);
        })
      );
    }
    lastFocusId = f.paneId;
    lastFocusStatus = f.status;
  });

  // Release the teleport target when the inbox is torn down (view -> grid) so the
  // surface returns to the grid body.
  $effect(() => () => surfaceSlot.clear());

  /** Select (watch) an agent: pin it as the focused row. */
  function selectAgent(paneId: string) {
    userSelected = paneId;
  }

  /** Step through the attention queue from the header ↑/↓ controls. */
  function stepQueue(dir: 1 | -1) {
    const next = nextInQueue(rows, focus?.paneId ?? null, dir);
    if (next) userSelected = next;
  }

  /** Expand the focused agent into the full terminal grid. */
  function expandToGrid() {
    const f = focus;
    if (!f) return;
    const target = navigateTarget(navWorkspaces, f.paneId);
    if (!target) return;
    workspace.setActiveWorkspace(target.workspaceId);
    workspace.setFocusIn(target.workspaceId, target.leafId);
    view.show('grid');
  }

  function newAgent() {
    launcher.show();
  }

  // ---- Display helpers ------------------------------------------------------

  function projAvatar(projectId: string | null): { icon: string; color: string } {
    const p = projectForId(projects.list, projectId);
    return p ? { icon: p.icon, color: p.color } : { icon: 'folder', color: '#7B8499' };
  }

  function cost(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }
  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  function badgeClass(status: AgentStatus): string {
    if (status === 'working') return 'b-active';
    if (status === 'error') return 'b-abort';
    if (isAttention(status)) return 'b-review';
    if (status === 'finished') return 'b-nominal';
    return 'b-standby';
  }

  /** The secondary line for a roster row: question / current action / cost·model. */
  function rowSub(r: AgentRow): string {
    if (isAttention(r.status)) {
      if (r.status === 'error') return 'Errored — needs you';
      if (r.questions && r.questions.length > 0) return r.questions[0].question;
      return r.question ?? 'Needs input';
    }
    if (r.status === 'finished') return cost(r.cost);
    return r.currentAction ?? r.summary ?? 'Working…';
  }

  /** The focus header's state chip text. */
  function focusChip(r: AgentRow): string {
    if (isAttention(r.status)) {
      const i = queue.findIndex((q) => q.paneId === r.paneId);
      return `needs you · ${i >= 0 ? i + 1 : 1}/${queue.length}`;
    }
    if (r.status === 'finished') return 'finished';
    return 'watching';
  }
</script>

<div class="inbox-shell">
  <ProjectPanel rows={allRows} />

  <section class="inbox" aria-label="Agent inbox">
    <!-- LEFT: grouped roster -->
    <div class="col-list">
      <div class="lh">
        <img class="logo" src="/logomark.svg" alt="" aria-hidden="true" />
        <h1>Agents <span class="count">{rows.length}</span></h1>
        <span class="sub">
          {#if attnCount > 0}{attnCount} need{attnCount === 1 ? 's' : ''} you{:else}all clear{/if}
        </span>
        <button type="button" class="launch" onclick={newAgent} title="Launch a new agent (⌘N)">＋</button>
      </div>

      {#if rows.length === 0}
        <div class="empty-list">
          <p>No agents yet.</p>
          <button type="button" class="btn-primary" onclick={newAgent}>＋ Launch mission</button>
        </div>
      {:else}
        <div class="list-scroll">
          {#each LANE_ORDER as lane (lane)}
            {@const items = grouped[lane]}
            {#if items.length > 0}
              <div class="group-h {lane}">
                {LANES[lane].title} <span class="gn">· {items.length}</span><span class="rule"></span>
              </div>
              {#each items as r (r.paneId)}
                <button
                  type="button"
                  class="row {lane}"
                  class:sel={focus?.paneId === r.paneId}
                  onclick={() => selectAgent(r.paneId)}
                >
                  <ProjectIcon {...projAvatar(r.projectId)} size={30} />
                  <span class="nm">
                    <span class="t">{titles.titleFor(r.paneId) ?? r.name}</span>
                    <span class="s" class:q={isAttention(r.status)} title={rowSub(r)}>{rowSub(r)}</span>
                  </span>
                  <span class="badge {badgeClass(r.status)} dotonly"><span class="dot"></span></span>
                </button>
              {/each}
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <!-- RIGHT: focus pane (header + teleported live TUI / All clear) -->
    <div class="col-focus">
      {#if focus}
        {@const av = projAvatar(focus.projectId)}
        <div class="fhead">
          <ProjectIcon {...av} size={26} />
          <span class="ttl">{titles.titleFor(focus.paneId) ?? focus.name}</span>
          <span class="chip {badgeClass(focus.status)}">{focusChip(focus)}</span>
          <span class="spc"></span>
          <span class="meta">
            <span class="ctxmini" class:unknown={focus.contextPct === null}>
              <span class="track">
                {#if focus.contextPct !== null}<i style:width={`${Math.max(0, Math.min(100, focus.contextPct))}%`}></i>{/if}
              </span>
              {pct(focus.contextPct)}
            </span>
            <span class="cost">{cost(focus.cost)}</span>
          </span>
          {#if isAttention(focus.status) && queue.length > 1}
            <span class="nav">
              <button type="button" onclick={() => stepQueue(-1)} title="Previous">↑</button>
              <button type="button" onclick={() => stepQueue(1)} title="Next">↓</button>
            </span>
          {/if}
          <button type="button" class="iconbtn" onclick={expandToGrid} title="Expand to grid">⤢</button>
        </div>
        <!-- The single mounted workspace surface is teleported in here. -->
        <div class="focus-slot" class:attn={isAttention(focus.status)} bind:this={focusSlot}></div>
      {:else}
        <div class="fhead">
          <span class="chip b-nominal">inbox zero</span>
          <span class="ttl muted">Nothing needs you</span>
          <span class="spc"></span>
        </div>
        <div class="empty">
          <div class="ring">✓</div>
          <h3>All clear</h3>
          <p>No agent is waiting on you. The next one that needs input lands here automatically — or pick any agent on the left to watch its terminal.</p>
        </div>
        <!-- Slot still bound so a fresh attention agent can teleport in without a remount. -->
        <div class="focus-slot hidden" bind:this={focusSlot}></div>
      {/if}
    </div>
  </section>
</div>

<style>
  .inbox-shell { display: flex; flex-direction: row; flex: 1 1 auto; width: 100%; min-height: 0; }
  .inbox-shell :global(.ppanel) { flex: 0 0 220px; width: 220px; }
  .inbox {
    display: grid; grid-template-columns: 360px 1fr;
    flex: 1 1 auto; min-width: 0; height: 100%; min-height: 0;
    background: var(--space-850); color: var(--fg-1); font-family: var(--font-sans);
  }

  .col-list { border-right: 1px solid var(--line-subtle); background: var(--space-900); display: flex; flex-direction: column; min-height: 0; }
  .lh { display: flex; align-items: center; gap: 10px; padding: 15px 16px 11px; flex: none; }
  .lh .logo { width: 22px; height: 22px; }
  .lh h1 { font-family: var(--font-display); font-weight: 600; font-size: 17px; margin: 0; display: flex; align-items: baseline; gap: 8px; }
  .lh .count { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); background: var(--space-750); border: 1px solid var(--line-subtle); border-radius: var(--r-full); padding: 2px 8px; }
  .lh .sub { font-size: 12px; color: var(--orange-300); font-weight: 600; }
  .lh .launch { margin-left: auto; font-family: var(--font-sans); font-weight: 700; font-size: 15px; color: #fff; background: var(--blue-500); border: none; border-radius: var(--r-md); width: 30px; height: 30px; cursor: pointer; }
  .list-scroll { overflow-y: auto; flex: 1; min-height: 0; padding-bottom: 20px; }
  .empty-list { padding: 40px 18px; text-align: center; color: var(--fg-3); display: flex; flex-direction: column; gap: 12px; }

  .group-h { display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: var(--tracking-label); }
  .group-h.attn { color: var(--orange-300); }
  .group-h.flight { color: var(--blue-300); }
  .group-h.done { color: var(--fg-4); }
  .group-h .gn { color: var(--fg-4); }
  .group-h .rule { flex: 1; height: 1px; background: var(--line-faint); }

  .row { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; padding: 10px 16px; cursor: pointer; border: none; border-left: 2px solid transparent; background: none; transition: background var(--dur-fast); }
  .row:hover { background: rgba(255,255,255,0.025); }
  .row.sel { background: rgba(61,123,255,0.10); border-left-color: var(--blue-500); }
  .row.attn.sel { background: var(--orange-tint); border-left-color: var(--orange-500); }
  .row .nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .row .nm .t { font-weight: 600; font-size: 13px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .nm .s { font-size: 11px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .row .nm .s.q { color: var(--orange-300); }

  .col-focus { background: var(--space-850); min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .fhead { flex: none; display: flex; align-items: center; gap: 11px; padding: 11px 18px; border-bottom: 1px solid var(--line-subtle); background: var(--space-900); }
  .fhead .ttl { font-weight: 600; font-size: 13.5px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .fhead .ttl.muted { color: var(--fg-3); font-weight: 500; }
  .fhead .chip { font-family: var(--font-mono); font-size: 10px; border-radius: var(--r-full); padding: 3px 9px; white-space: nowrap; flex: none; }
  .fhead .spc { flex: 1; }
  .fhead .meta { display: flex; align-items: center; gap: 12px; flex: none; }
  .fhead .nav { display: flex; gap: 4px; flex: none; }
  .fhead .nav button, .fhead .iconbtn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-sm); background: var(--space-750); border: 1px solid var(--line-subtle); color: var(--fg-3); cursor: pointer; font-size: 13px; }
  .fhead .nav button:hover, .fhead .iconbtn:hover { color: var(--fg-1); border-color: var(--line-default); }

  .focus-slot { flex: 1; min-height: 0; display: flex; padding: 10px; }
  /* The teleported surface fills the slot. */
  .focus-slot :global(.surface),
  .focus-slot :global(.workspace) { flex: 1 1 auto; min-width: 0; min-height: 0; }
  .focus-slot.attn { box-shadow: inset 0 0 0 1px rgba(238,126,77,0.18); border-radius: var(--r-md); }
  .focus-slot.hidden { display: none; }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 40px; }
  .empty .ring { width: 64px; height: 64px; border-radius: 50%; background: var(--nominal-tint); color: #6fe0a6; display: flex; align-items: center; justify-content: center; font-size: 30px; }
  .empty h3 { font-family: var(--font-display); font-weight: 600; font-size: 18px; margin: 0; color: var(--fg-1); }
  .empty p { margin: 0; font-size: 13.5px; color: var(--fg-3); max-width: 340px; line-height: 1.5; }

  /* status badges + ctx gauge (shared look) */
  .badge { display: inline-flex; align-items: center; gap: 6px; }
  .badge.dotonly { padding: 0; }
  .badge .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .b-active { color: var(--blue-300); }
  .b-active.chip { background: var(--blue-tint); }
  .b-active .dot { animation: workpulse 1.4s var(--ease-out) infinite; }
  @keyframes workpulse {
    0% { box-shadow: 0 0 0 0 rgba(86,156,255,0.5); opacity: 1; }
    70% { box-shadow: 0 0 0 5px rgba(86,156,255,0); opacity: 0.6; }
    100% { box-shadow: 0 0 0 0 rgba(86,156,255,0); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .b-active .dot { animation: none; } }
  .b-review { color: var(--orange-300); }
  .b-review.chip { background: var(--orange-tint); }
  .b-nominal { color: #6fe0a6; }
  .b-nominal.chip { background: var(--nominal-tint); }
  .b-abort { color: #ff8077; }
  .b-abort.chip { background: var(--abort-tint); }
  .b-standby { color: var(--fg-3); }

  .ctxmini { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
  .ctxmini .track { width: 46px; height: 4px; border-radius: 2px; background: var(--space-600); overflow: hidden; }
  .ctxmini.unknown .track { background: repeating-linear-gradient(-45deg, var(--space-600), var(--space-600) 3px, var(--space-700) 3px, var(--space-700) 6px); }
  .ctxmini .track i { display: block; height: 100%; background: linear-gradient(90deg, var(--blue-500), var(--blue-400)); }
  .cost { font-family: var(--font-mono); font-size: 11px; color: var(--fg-1); font-weight: 500; font-variant-numeric: tabular-nums; }

  .btn-primary { font-family: var(--font-sans); font-weight: 600; font-size: 13px; color: #fff; background: var(--blue-500); border: none; border-radius: var(--r-md); padding: 9px 15px; cursor: pointer; }
</style>
```

- [ ] **Step 2: Verify the build is clean**

Run: `npm run check`
Expected: `svelte-check` reports 0 errors / 0 warnings. (If `aggregate` complains about the empty `subagentCosts` type, annotate it as shown: `[] as { cost: number | null }[]`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/overview/Inbox.svelte
git commit -m "feat(overview): Inbox surface — grouped roster + teleported live-TUI focus"
```

---

## Task 6: Wire the inbox into the route

Render `<Inbox />` for the overview, and put the `portal` action on the workspace surface so it teleports to the inbox focus slot (or stays home in the grid body).

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Import the inbox, portal, and surface slot**

In the `<script>` block of `src/routes/+page.svelte`, replace the Overview import:

```ts
  import Overview from '$lib/overview/Overview.svelte';
```

with:

```ts
  import Inbox from '$lib/overview/Inbox.svelte';
  import { portal } from '$lib/layout/portal.ts';
  import { surfaceSlot } from '$lib/layout/surfaceSlot.svelte';
```

- [ ] **Step 2: Put the portal action on the surface**

Find the workspace surface (`+page.svelte`, the `<main class="surface">` inside `.body`):

```svelte
    <main class="surface">
      {#each workspace.workspaces as ws (ws.id)}
```

Change the opening tag to attach the portal, driven by the surface-slot target:

```svelte
    <main class="surface" use:portal={surfaceSlot.target}>
      {#each workspace.workspaces as ws (ws.id)}
```

(When `surfaceSlot.target` is null the surface stays in the grid body; when the inbox sets it, the surface is teleported into the focus slot. The action re-runs on every target change.)

- [ ] **Step 3: Render the inbox for the overview**

Find the overview render:

```svelte
  {#if view.isOverview}
    <Overview />
  {/if}
```

Replace with:

```svelte
  {#if view.isOverview}
    <Inbox />
  {/if}
```

- [ ] **Step 4: Verify the build is clean**

Run: `npm run check`
Expected: `svelte-check` 0 errors / 0 warnings.

- [ ] **Step 5: Manual smoke (live app)**

Run: `npm run tauri dev` (or the project's dev command).
Verify:
1. The overview shows the grouped roster on the left; an attention agent's live terminal appears on the right, focused, scrolled to bottom.
2. Typing goes into that terminal; answering a question (so it resumes working) advances the focus to the next attention agent.
3. With no attention agents and nothing selected, the right shows "All clear".
4. Clicking a working agent on the left shows its live terminal on the right (watch).
5. `⤢` switches to the grid with that pane focused and still live (same session — scrollback intact, **no respawn**).
6. Switching overview ↔ grid repeatedly keeps every PTY alive (no "[process exited]", no duplicate output).

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(overview): render the Inbox and teleport the surface via portal"
```

---

## Task 7: Update the agent-overview spec + scenario gate

Replace the card/lanes requirement with the inbox master–detail requirement and scenarios. The pure-core scenarios map to `inbox.test.ts`; the live-only ones go in `MANUAL_SCENARIOS`.

**Files:**
- Modify: `openspec/changes/add-agent-desktop/specs/agent-overview/spec.md`
- Modify: `tools/check-scenario-coverage.mjs`

- [ ] **Step 1: Read the current requirement block**

Run: `grep -n "Requirement:\|#### Scenario:" openspec/changes/add-agent-desktop/specs/agent-overview/spec.md`
Identify the requirement that describes the three-lane card overview (e.g. "Agent Roster Overview") and the lane/card scenarios under it.

- [ ] **Step 2: Replace the card requirement with the inbox requirement**

In `openspec/changes/add-agent-desktop/specs/agent-overview/spec.md`, replace the card-overview requirement's scenarios with this block (keep the requirement heading text, or rename it to "Agent Inbox Overview"; keep the separate Message/Navigate/Usage requirements untouched):

```markdown
### Requirement: Agent Inbox Overview

The overview SHALL present every agent as an inbox: a grouped roster (Needs you /
In flight / Completed) on the left, and a single focus pane on the right that shows
the selected agent's live terminal. The focus pane SHALL auto-fill from the
attention queue, advance to the next when the focused agent is addressed, and show
an "All clear" state when nothing needs the user and nothing is selected.

#### Scenario: Attention queue surfaces waiting and errored agents

- **WHEN** the roster contains working, waiting, finished, and errored agents
- **THEN** the attention queue lists only the waiting and errored agents, in roster order

#### Scenario: Focus resolves to the user selection before the queue

- **WHEN** the user has selected an agent that still exists in the roster
- **THEN** the focus pane shows that agent, not the head of the attention queue

#### Scenario: Focus falls back to the attention queue when nothing is selected

- **WHEN** no agent is selected
- **THEN** the focus pane shows the first agent in the attention queue

#### Scenario: Focus is empty when nothing needs attention and nothing is selected

- **WHEN** no agent needs attention and none is selected
- **THEN** the focus pane shows the "All clear" state

#### Scenario: Addressed attention agent advances the focus to the next

- **WHEN** the focused attention agent transitions out of needing attention
- **THEN** the focus advances to the next agent in the attention queue

#### Scenario: Queue navigation steps through waiting agents

- **WHEN** the user steps the focus header's queue navigation
- **THEN** the focus moves to the next or previous agent in the attention queue, wrapping at the ends

#### Scenario: Entering an agent focuses its terminal and scrolls to the bottom

- **WHEN** an agent becomes the focused one in the inbox
- **THEN** its live terminal is focused and scrolled to the bottom

#### Scenario: The live surface is teleported into the focus pane without respawning

- **WHEN** an agent is shown in the focus pane and then expanded to the grid
- **THEN** the same live terminal session is used throughout, with no PTY respawn
```

- [ ] **Step 3: Allowlist the live-only scenarios in the gate**

In `tools/check-scenario-coverage.mjs`, find the `MANUAL_SCENARIOS` entry for `agent-overview` (add the key if absent) and include the two live-only scenario snake_case ids:

```js
  'agent-overview': new Set([
    // ...any existing manual scenarios...
    'entering_an_agent_focuses_its_terminal_and_scrolls_to_the_bottom',
    'the_live_surface_is_teleported_into_the_focus_pane_without_respawning'
  ]),
```

(The six pure scenarios are covered by `inbox.test.ts`, whose `describe` titles match the scenario titles.)

- [ ] **Step 4: Run the scenario gate**

Run: `node tools/check-scenario-coverage.mjs`
Expected: PASS — every agent-overview scenario maps to a test or is allowlisted.

- [ ] **Step 5: Validate the spec**

Run: `openspec validate --strict`
Expected: all active changes pass.

- [ ] **Step 6: Commit**

```bash
git add openspec/changes/add-agent-desktop/specs/agent-overview/spec.md tools/check-scenario-coverage.mjs
git commit -m "openspec(agent-overview): inbox overview requirement + scenarios"
```

---

## Task 8: Retire the card Overview

With the inbox rendering and the gate green, remove the superseded card component. Its pure cores stay; only the component file goes.

**Files:**
- Delete: `src/lib/overview/Overview.svelte`

- [ ] **Step 1: Confirm nothing imports Overview.svelte**

Run: `grep -rn "Overview.svelte\|from './Overview'\|overview/Overview" src/`
Expected: no remaining references (after Task 6 swapped `+page.svelte`). If any non-test reference remains, update it to `Inbox.svelte` first.

- [ ] **Step 2: Delete the component**

Run: `git rm src/lib/overview/Overview.svelte`

- [ ] **Step 3: Verify the build + full test suite**

Run: `npm run check`
Expected: `svelte-check` 0 errors / 0 warnings.

Run: `npx vitest run`
Expected: all suites pass (the pure overview cores — roster/message/navigate/usage/answer — remain tested; inbox/portal/terminals/surfaceSlot added).

- [ ] **Step 4: Run the full pre-commit gate**

Run: `node tools/check-scenario-coverage.mjs && openspec validate --strict`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(overview): retire the card Overview (superseded by the Inbox)"
```

---

## Self-review (completed during planning)

**Spec coverage:**
- Grouped roster (Needs you / In flight / Completed), status circle → Task 5 (`groupByLane` + `.row` + `.badge.dotonly`).
- Single focus pane, thin header, live TUI, no footer → Task 5 (`.fhead` + `.focus-slot`, no input element).
- Auto-focus + scroll-to-bottom on entry → Task 3 (handle/helpers) + Task 5 (entry `$effect` → `tick`/raf → `scrollTerminalToBottom`/`focusTerminal`); scenario in Task 7.
- Attention queue + auto-advance + empty state → Task 4 (`attentionQueue`/`resolveFocus`/`shouldClearPin`) + Task 5 wiring.
- Teleport one mounted surface, no double-spawn → Tasks 1, 2, 6 (portal + surfaceSlot + `use:portal`); selection stays `setActiveWorkspace`/`setFocusIn`; verified in Task 6 smoke + Task 7 scenario.
- Watch any agent → Task 5 (`selectAgent` pins `userSelected`; `resolveFocus` precedence).
- Reuse roster/events/titles/snapshots → Task 5 imports them unchanged.
- Expand to grid → Task 5 (`expandToGrid` → `view.show('grid')`).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type consistency:** `TerminalHandle.focus()/scrollToBottom()` (Task 3) match the `focusTerminal`/`scrollTerminalToBottom` helpers (Task 3) and their calls in `Inbox.svelte` (Task 5). `attentionQueue`/`resolveFocus`/`nextInQueue`/`shouldClearPin`/`isAttention` signatures (Task 4) match every call in Task 5. `surfaceSlot.set/clear/target` (Task 2) match `Inbox.svelte` + `+page.svelte` (Tasks 5, 6). `portal(node, target)` returning `{update, destroy}` (Task 1) matches `use:portal={surfaceSlot.target}` (Task 6).
