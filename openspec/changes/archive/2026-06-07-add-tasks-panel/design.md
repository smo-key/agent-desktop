## Context

The app already ships a project-scoped terminals system (the unarchived
`add-terminals-panel` change):

- `src/lib/terminals/projectTerminals.ts` — pure model: `TerminalDef
  { id, name, command, cwd }`, per-project envelope `{ version, projects: {
  [projectId]: TerminalDef[] } }`, name derivation, runtime/persisted split.
- `src/lib/terminals/projectTerminals.svelte.ts` — runes store: load/save via
  Tauri `terminals_load`/`terminals_save` (`terminals.json`), runtime state
  (`paneId`, `running`, `exitCode`, `title`), create/start/stop/remove,
  selective auto-restart via `wasRunning`.
- `src/lib/terminals/TerminalsPanel.svelte` — right-docked vertical resizable
  stack; one `TerminalPane` per terminal; `+` to add; start/stop/remove; OSC
  title; per-terminal gutter resize.
- `src/lib/terminals/activeProject.ts` — resolves the active project from the
  focused pane's `registry[focusedId].projectId`.
- Mounted in `src/routes/+page.svelte`: right dock, ⌘J toggle, ⌘T new shell,
  running-count badge. On exit a terminal becomes a persisted "stopped" slot.

This change promotes that primitive to **Tasks**. A task is a named, project
-scoped runnable of one of two kinds: a shell **command** (terminal) or a Claude
**prompt** (agent). It adds a left-side launcher panel, renames the right panel,
and changes completion semantics (auto-close on success, keep-on-error) for
command tasks — while keeping bare interactive shells behaving as they do today.

Constraints: `openspec/specs/` is empty (whole app pre-archive); PTY spawn,
the Claude session-launch path, and the projects model must be reused unchanged;
existing resize/persistence primitives should be reused.

## Goals / Non-Goals

**Goals:**
- One unified, project-scoped task model covering both terminal and agent kinds,
  evolved from the existing project-terminals model (least duplication).
- A bottom-left Tasks launcher under the Agents rail (resizable splitter, ~⅓),
  list UI mirroring the Agents rail.
- Right panel renamed "Tasks", `+` removed; terminal tasks auto-close on success,
  stay open + failed on error; long-runners persist until stopped.
- Agent tasks open a normal Claude workspace session seeded with the prompt.
- Bare shells still launchable (⌘Y + the Terminals panel `＋`); they close on a
  clean exit and stay on error, same as terminal tasks.

**Non-Goals:**
- Changing PTY/agent spawn internals.
- Cross-project task sharing, task scheduling, dependencies between tasks, or
  task run history. (Editing a task's DEFINITION — name/kind/command/prompt — is
  in scope, via the create/edit dialog; it applies on the next run.)
- Restyling the Agents rail itself.

## Decisions

### D1 — Evolve `terminals` → `tasks` (rename), don't add a parallel layer
Rename `src/lib/terminals/` → `src/lib/tasks/`, `projectTerminals*` →
`projectTasks*`, `TerminalDef` → `TaskDef`, on-disk `terminals.json` →
`tasks.json`, Tauri `terminals_load/save` → `tasks_load/save`. `TaskDef` gains
`kind: 'terminal' | 'agent'`, `command?` (terminal), `prompt?` (agent).
- *Why:* the existing model is ~90% of a task; a parallel layer would duplicate
  persistence, runtime tracking, and project scoping. This is internal state
  with no external consumers, so the rename is safe.
- *Alternative rejected:* keep `terminals` and add a `tasks` layer on top — more
  files, two persistence stores, drift risk.

### D2 — Migration: load legacy `terminals.json` once
On first `tasks_load`, if `tasks.json` is absent but `terminals.json` exists,
read the legacy file and map each `TerminalDef` → `TaskDef` with
`kind: 'terminal'`, then write `tasks.json`. Bare entries (`command: null`)
remain bare terminals.
- *Why:* preserves any terminals a user already defined without a hard reset.
- *Trade-off:* a small one-time shim in the store/backend; acceptable.

### D3 — Bare terminal vs task = a transient runtime entry, not a `TaskDef`
A bare interactive terminal is launched from the right-docked **Terminals**
panel's `＋` button and via **⌘Y**. It is a transient runtime-only entry (no
`TaskDef`, never persisted). A task is a saved `TaskDef`. Completion semantics are
UNIFORM for any terminal — task or bare: a clean exit (code 0) closes it (the
pane/slot is removed); a non-zero exit keeps it visible so the error is readable.
- *Why:* matches the user's "a bare terminal is a different experience from a
  task" while reusing one runtime/store. The bare-terminal entry lives in the
  Terminals panel (where the running shells appear), not the task launcher.
- *Note:* ⌘T no longer launches a bare terminal — it opens the create-task
  dialog (D8). ⌘Y is the bare-terminal shortcut.

### D8 — Create/edit via a modal dialog (mimics New session)
Task creation and editing happen in a modal `TaskDialog.svelte` modeled on the
session `Launcher.svelte` (backdrop, dialog card, kind selector, name + command/
prompt fields, Cancel + blue primary, Esc / ⌘-Enter). A small `taskDialog` store
(mirroring `launcherStore`) holds open/edit/project state so the launcher header
`＋`, a row's context-menu edit, and ⌘T can all open it. The task **name is
optional** (the store derives a default from the command/prompt when blank); the
terminal command field is monospace. The store gains an `update(id, fields)`
method for edits. In the launcher, **clicking a row starts** the task (a running
row reveals the Terminals panel) and a **right-click context menu** (the shared
`ContextMenu`) offers Edit / Delete (+ Stop / Dismiss contextually); Delete goes
through a `confirm()` (the same pattern the session rail uses).
- *Why:* the inline form was cramped and offered no edit path; a dialog matches
  the app's existing create flow. Click-to-start makes the common action one
  click, and the context menu keeps management actions out of the way.

### D4 — Completion semantics for terminal tasks
On PTY exit for a terminal-kind task: exit code 0 → remove the running pane from
the right panel (auto-close); non-zero → keep the pane, mark the task `failed`
(red), expose a dismiss action that removes the pane. The left Tasks list always
reflects status (running / idle / succeeded transient / failed). Long-running
tasks simply never exit until stopped, so they persist naturally.
- *Why:* quick tasks (Git Push) shouldn't leave clutter on success but must stay
  visible to debug on failure.

### D5 — Agent tasks route to a workspace session, not the right panel
Starting an agent task calls the existing workspace session-launch path
(`workspace.svelte.ts`) to open a new Claude session in the main workspace +
Agents rail, seeded with the task's `prompt` as initial input. It does not create
a right-panel pane.
- *Why:* agent tasks ARE Claude sessions; the workspace/Agents rail is their
  natural home and already handles their lifecycle. The right panel stays a
  terminal surface.
- *Trade-off:* the right "Tasks" panel only ever shows terminal tasks; agent
  tasks' status in the left list is derived from the spawned session.

### D6 — Left launcher placement & resize
The visible "Agents panel" is the **Inbox roster column** (`Inbox.svelte`
`.col-list`, header "Agents"), NOT the hidden grid-view `SessionRail`. Add the
Tasks launcher at the bottom of `.col-list`, beneath the agent `.list-scroll`,
separated by a draggable horizontal splitter; default ~⅓ of the column height,
persisted ratio. `.col-list` is already a flex column with `min-height:0`, so the
splitter reapportions the agent list (top) and Tasks (bottom). Reuse a flex
weight / pointer-drag gutter as elsewhere in the app.
- *Why:* attaches Tasks to the surface the user actually sees, keeps the Agents
  column cohesive, and reuses the proven resize pattern.

### D7 — Reuse `activeProject` derivation for scoping
Both panels show the active project's tasks via the existing focused-pane →
`projectId` resolver (renamed into `src/lib/tasks/activeProject.ts`).

## Risks / Trade-offs

- **[Rename churn across an unarchived sibling change]** `add-terminals-panel`
  remains unarchived and now describes a superseded model. → Note the
  supersession in this change's proposal; at archive time, the durable specs
  reflect `project-tasks`/`tasks-panel`. Reconcile during close-out.
- **[Legacy data loss]** Users with `terminals.json` could lose entries on
  rename. → D2 one-time migration shim; cover with a test.
- **[Two surfaces both labeled "Tasks"]** Left launcher and right runner share
  the name. → Intentional: left = definitions/launch, right = running terminal
  tasks; distinct positions and content. Revisit only if user-confusing.
- **[Agent task status fidelity]** Mapping a spawned session's lifecycle back to
  the left list's status is indirect. → Keep it best-effort (running while the
  session is open); do not block the core terminal-task flow on it.
- **[⌘T / `+` removal discoverability]** Removing `+` may hide bare-shell
  creation. → `[⊳ Terminal]` footer action + retained ⌘T shortcut + (optional)
  tooltip.

## Migration Plan

1. Backend: add `tasks_load`/`tasks_save` (keep `terminals_*` temporarily as
   thin aliases or remove after frontend cutover); `tasks.json` path.
2. Frontend: rename module dir + symbols; extend model with `kind`/`prompt`;
   implement D2 legacy import.
3. UI: build left launcher + splitter; rename right panel, remove `+`, wire
   completion semantics (D4) and agent routing (D5); update +page.svelte
   (badge, ⌘T, mount).
4. Remove dead `terminals_*` once nothing references them.
- *Rollback:* internal-only state; revert the branch. `terminals.json` is left
  untouched by the importer (read-only), so reverting restores prior behavior.

## Open Questions

- None blocking. (Resolved in the requirements interview: architecture = evolve;
  agent tasks → workspace session; bare shell via ⌘T + footer; keep-open-on
  -error.)
