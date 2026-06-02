# Mission Control — App UI Kit

A high-fidelity, interactive recreation of the **Mission Control desktop app**: the
control room where a human manages a fleet of AI agents. It's a click-through prototype —
cosmetic, not production code — built to be pixel-faithful and reusable.

Open **`index.html`** to use it.

## What's here

The **whole experience is the control room**. A hideable **project panel** (left) filters
the fleet by project, with a live count and an orange dot when a project needs you, and a
**＋ New project** action. Each **project carries an icon + color** (or a logo) that
becomes the **agent's icon**, so the fleet reads by project at a glance. Agents are
identified by a short **AI-generated title**, optionally prefixed with a ticket
(e.g. *PAY-204: Refactor the auth module*, or just *Create API reference*). The main area
is one full-width, two-column fleet, organized into three lanes, top → bottom by how much
they need you:

1. **Needs attention** (top) — agents *waiting on you*. Each card shows the agent's latest
   message and an inline action: **Approve / Deny** a command, pick an **option** (or type
   a reply) for a question, give **feedback** (Looks good / Request changes), or handle a
   **hand-off** — an agent that *finished* but left a **file to review** (click it to open
   the agent) or a **human action** to perform, cleared with one button.
2. **Completed** (middle) — finished missions with their closing message.
3. **In flight** (bottom) — agents running happily on their own (these need you least).

Every card shows the agent's **title**, its **last message**, and a **task-progress
strip** — mini segments, one per task, with the active one flashing (agents without a
task list fall back to a single bar). **Click anywhere on a card** (except a button or
input) to open **mission detail** — whose main area is a full-width **terminal to the
agent** (placeholder for now; an interactive session is coming), with Pause / Abort and a
back link. A persistent **status bar** along the bottom shows account usage limits
(5h / 7d remaining) and spend + token totals — fleet-wide in the control room, **scoped to
the open agent** in detail.

A **Launch mission** modal (objective + project, with a project picker that shows icons
and can **create a new project**) dispatches a new agent into the In-flight lane — also
bound to **⌘N**. (All agents run in auto mode — no autonomy setting.)

## Interactions that work

- **Filter by project** in the left panel; collapse/expand it from the panel or the header
  toggle.
- **Approve & continue / Deny** an approval → the agent leaves "Needs attention" and
  rejoins "In flight"; the header counts update live.
- Answer a question by **picking an option** or typing a **reply** → agent acknowledges
  the choice and resumes.
- **Looks good / Request changes** on a review request → agent resumes accordingly.
- On a **hand-off**, click a called-out **file** to review it (opens the agent), or clear
  the card with its action button → the agent goes **back to In flight**.
- **Create a project** (and **choose its icon + color**) from the panel (＋ New project)
  or the launch modal's picker.
- Click anywhere on a card (except a button/input) → **mission detail**; back link returns.
- **Pause / Resume / Abort** from the detail header.
- **Launch mission** (or **⌘N**) → pick a project, adds a new in-flight agent and opens it.
- Search is cosmetic.

## Files

| File | Role |
|---|---|
| `index.html` | Loads React + Babel + Lucide and all components. |
| `app.css` | All layout & component styles (imports the root design tokens). |
| `ui.jsx` | Primitives: `Icon` (Lucide wrapper), `StatusDot`, `Badge`, `Button`, `AgentAvatar`. |
| `ProjectPanel.jsx` | Hideable left rail — filter by project + create projects. |
| `AgentCard.jsx` | Control-room card: title + last message + actions + task strip. |
| `Dashboard.jsx` | `Lane` + the three-lane control room (header, search, launch). |
| `StatusBar.jsx` | Persistent usage footer (limits + spend/tokens), fleet- or agent-scoped. |
| `Approval.jsx` | `ApprovalRow` — approve/deny row used in mission detail. |
| `MissionDetail.jsx` | Full-width agent terminal (placeholder). |
| `LaunchModal.jsx` | New-mission composer + `ProjectSelect` (icon dropdown + create). |
| `app.jsx` | Seed data (agents w/ lanes, last messages, asks), state, handlers, shell. |

## Notes & conventions

- **Icons:** Lucide via CDN, 1.75px stroke. The `Icon` component injects an
  `<i data-lucide>` and lets Lucide swap in the SVG (uniform stroke = one global
  `createIcons()` call is safe).
- **Components share scope via `window`** — each Babel `<script>` is its own module, so
  every component is published with `Object.assign(window, {...})` and load order in
  `index.html` matters (`ui.jsx` first, `app.jsx` last).
- **Data model:** each agent has a `project` (which supplies its icon + color), an
  AI-style `summary` title and optional `ticket`, a `lastMessage`, an optional `tasks`
  `{ total, done }` (for the segmented progress strip), a `lane`
  (`attn` / `done` / `flight`), and — when in `attn` — an `ask`: `approval` (`command`),
  `question` (optional `options`), `review`, or `handoff` (`files[]` and/or a human
  `action`, with a `cta`). Projects live in `ui.jsx` (`MC_PROJECTS`, plus `addProject`).
- **Designed for desktop**, content centered at ~1080px; the grid drops to one column when
  narrow.
- This is a **recreation to a brief**, not a port of real product code. The lane-based
  control room is a proposal — validate against the real app if/when one exists.
