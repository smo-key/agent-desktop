<script lang="ts">
  import { onMount } from 'svelte';
  import PaneNode from '$lib/layout/PaneNode.svelte';
  import PaneContextMenu from '$lib/layout/PaneContextMenu.svelte';
  import SessionRail from '$lib/layout/SessionRail.svelte';
  import Launcher from '$lib/launcher/Launcher.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import HelpModal from '$lib/ui/HelpModal.svelte';
  import { help } from '$lib/ui/helpStore.svelte';
  import SettingsModal from '$lib/ui/SettingsModal.svelte';
  import ConfirmModal from '$lib/ui/ConfirmModal.svelte';
  import { confirmModal } from '$lib/ui/confirmStore.svelte';
  import { settingsModal } from '$lib/ui/settingsStore.svelte';
  import { openWith } from '$lib/settings/openWith.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import { autoAdvance } from '$lib/settings/autoAdvance.svelte';
  import { titleSettings } from '$lib/settings/titles.svelte';
  import VoicePanel from '$lib/voice/VoicePanel.svelte';
  import ModelOnboarding from '$lib/onboarding/ModelOnboarding.svelte';
  import { onboarding } from '$lib/onboarding/onboarding.svelte';
  import { initVoiceActivation } from '$lib/voice/activation';
  import Icon from '$lib/icons/Icon.svelte';
  import { tooltip } from '$lib/ui/tooltip';
  import { startNewSession } from '$lib/launcher/newSession';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { insertFilenameInto, focusedTerminalHandle } from '$lib/layout/insertFilename';
  import { rectsSnapshot } from '$lib/layout/rects.svelte';
  import { restorePersistedLayout, watchAndPersist } from '$lib/layout/store-backend.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { appSessionIds } from '$lib/usage/appSessions';
  import AppFooter from '$lib/usage/AppFooter.svelte';
  import Inbox from '$lib/overview/Inbox.svelte';
  import { portal } from '$lib/layout/portal';
  import { surfaceSlot } from '$lib/layout/surfaceSlot.svelte';
  import { view } from '$lib/overview/view.svelte';
  import { subagents, type SessionRef } from '$lib/overview/subagents.svelte';
  import { activity, type PaneRef } from '$lib/overview/activity.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectGit } from '$lib/projects/projectGit.svelte';
  import RunningTasksPanel from '$lib/tasks/RunningTasksPanel.svelte';
  import TaskDialog from '$lib/tasks/TaskDialog.svelte';
  import { taskDialog } from '$lib/tasks/taskDialogStore.svelte';
  import Toast from '$lib/ui/Toast.svelte';
  import { toast } from '$lib/ui/toastStore.svelte';
  import { tasksPanel } from '$lib/tasks/panel.svelte';
  import { projectTasks } from '$lib/tasks/projectTasks.svelte';
  import { taskAgentReturnedToUser } from '$lib/tasks/agentTask';
  import { activeProjectId } from '$lib/tasks/activeProject';
  import { projectForId } from '$lib/projects/projects';
  import { setGitTerminalOpener } from '$lib/projects/projectGitActions';
  import { setAgentTaskLauncher } from '$lib/projects/prActions';
  import { buildLaunchPlan } from '$lib/launcher/plan';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { ALL, UNASSIGNED } from '$lib/projects/projectRollup';
  import { focusTerminal, scrollTerminalToBottom } from '$lib/layout/terminals';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { events } from '$lib/overview/events.svelte';
  import { executor } from '$lib/orchestration/executor.svelte';
  import { titles } from '$lib/overview/titles.svelte';
  import { triggersTranscriptRead, SAFETY_POLL_MS } from '$lib/overview/poll';
  import { appSessionRefs } from '$lib/overview/sessionRefs';
  import { type SpatialDir } from '$lib/layout/tree';

  // True once the persisted layout has loaded (or fallen back to fresh). We hold
  // off rendering the workspace area until then so we never flash a throwaway
  // workspace whose PTYs we'd immediately tear down.
  let restored = $state(false);

  // Pane ids of Claude sessions spawned by an AGENT task. Once such a session
  // finishes the turn it was launched for and returns to the user, the watcher
  // effect below archives it (so task agents are fire-and-forget, not clutter).
  // A plain set: the effect re-runs off the event store, not off this set.
  const taskAgentPanes = new Set<string>();

  // Seed the store from the persisted layout (or a fresh single-pane `claude`
  // workspace on first launch / corrupt state), then start the debounced +
  // on-quit persistence. Rendering the restored PaneNodes re-spawns one PTY per
  // leaf (saved shell + cwd only) via each TerminalPane's mount.
  onMount(() => {
    // Load the user's open-with preferences (seeds defaults on first run).
    void openWith.load();
    // Load session-title preferences (the opt-in cloud title fallback).
    void titleSettings.load();
    // Load the auto-advance focus preference (opt-in; defaults OFF).
    void autoAdvance.load();
    // Load the persisted one-time onboarding flag FIRST so a returning user who has
    // already seen the gate never sees a flash of it, then load voice-input
    // preferences and check whether the on-device models that selection needs are
    // present. When they're missing AND the gate has never been seen, the onboarding
    // store goes `visible` and the full-screen gate (rendered below) prompts a
    // one-time download (model-onboarding spec).
    void onboarding.load()
      .then(() => voice.load())
      .then(() => onboarding.check(voice.prefs.modelTier, voice.prefs.polish))
      .catch(() => {});
    // Agent-kind tasks open a normal Claude session in the workspace + Agents rail
    // (design D5): wire the store's launcher hook to the same launch path used by
    // the inbox "+" / ⌘N, seeded with the task's prompt. Set BEFORE load() so a
    // task started early dispatches correctly.
    projectTasks.setAgentLauncher((def, projectId) => {
      const proj = projectForId(projects.list, projectId);
      if (!proj) return;
      const paneId = workspace.launch(
        buildLaunchPlan({
          folder: proj.path,
          prompt: def.prompt ?? '',
          placement: 'tab',
          projectId: proj.id
        })
      );
      // Remember this session was spawned by a task: once it finishes its turn and
      // returns to the user, an $effect (below) auto-archives it (project-tasks spec).
      if (paneId) taskAgentPanes.add(paneId);
    });
    // Footer actions (PR button, and later the commit button) spawn an
    // AUTO-ARCHIVING agent task via a generic `(projectId, prompt)` launcher —
    // EXACTLY mirroring the project-tasks agent launcher above so the same
    // auto-archive $effect (below) closes the fire-and-forget session once it
    // returns to the user. Shared on purpose; not PR-specific.
    setAgentTaskLauncher((projectId, prompt) => {
      const proj = projectForId(projects.list, projectId);
      if (!proj) return;
      const paneId = workspace.launch({
        ...buildLaunchPlan({
          folder: proj.path,
          prompt,
          placement: 'tab',
          projectId: proj.id
        }),
        // The footer Commit + Create-PR tasks ALWAYS run on Sonnet — they are
        // mechanical git chores (stage/commit, push/open-PR) that don't need the
        // default model, so force `--model sonnet` for cost/speed.
        extraArgs: ['--model', 'sonnet']
      });
      if (paneId) taskAgentPanes.add(paneId);
    });
    // A terminal task that succeeds (exit 0) pops a "<name> completed" toast.
    projectTasks.setTaskCompleteHandler((name) => toast.show(`${name} completed`));
    // A failed project Push/Pull (context menu or footer) opens an interactive
    // terminal in the project's folder running the failed git command, so the user
    // sees git's full output and can act (auth, conflict, retry). Reveals + focuses
    // the Terminals panel, mirroring `newTerminal()`.
    setGitTerminalOpener((projectId, command) => {
      tasksPanel.open = true;
      const id = projectTasks.launchBareTerminal(projectId, command);
      const pane = projectTasks.bareForProject(projectId).find((b) => b.id === id)?.paneId;
      if (pane) {
        lastCycledPaneId = pane;
        focusTerminal(pane); // registry parks the request until the pane mounts
      }
    });
    // Tasks now live in each project's `<project>/.agent-desktop/tasks.json`. The
    // store resolves the folder paths through the projects registry, so the projects
    // list MUST be loaded first. Inject the accessor, then load projects → tasks in
    // order (the one-time user-level → project-folder migration runs inside load()).
    projectTasks.setProjectsAccessor(() =>
      projects.list.map((p) => ({ id: p.id, path: p.path }))
    );
    void projects.load().then(() => projectTasks.load());
    // Terminals restore stopped now (auto-restart was dropped); the close handler is
    // kept (a no-op) so quit ordering is unchanged.
    let unlistenTermClose: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async () => {
        await projectTasks.captureRunningAndSave();
      })
      .then((un) => {
        unlistenTermClose = un;
      })
      .catch(() => {});
    let stopWatching: (() => void) | undefined;
    void restorePersistedLayout().then(() => {
      restored = true;
      // Seed restored agents' titles from the durable cache synchronously, so the
      // cards render their real titles immediately rather than flashing their
      // "Session N" fallback until the first (async) activity poll lands.
      titles.hydrate(currentPaneRefs());
      stopWatching = watchAndPersist();
    });

    // Seed the usage-dashboard snapshots store from the current set, then
    // subscribe to live `usage://snapshot` pushes from the Rust watcher. The
    // unlisten fn is captured and called on teardown.
    let unlistenSnapshots: (() => void) | undefined;
    void snapshots.start().then((unlisten) => {
      unlistenSnapshots = unlisten;
    });

    // Seed the SUBAGENTS store (agent-overview) with the app's current app-pane
    // session refs ({sessionId, cwd}), then subscribe to live `overview://subagents`
    // pushes from the Rust subagent watcher. A separate $effect (below) re-seeds the
    // watched-set whenever the app's session set changes.
    let unlistenSubagents: (() => void) | undefined;
    void subagents.start(currentSessionRefs()).then((unlisten) => {
      unlistenSubagents = unlisten;
    });

    // Prime TRANSCRIPT ACTIVITY once on mount (each claude pane's last message +
    // any pending question, read from its transcript by cwd). Event-driven reads
    // (below) keep it fresh, with a slow safety poll as the backstop.
    void refreshActivity();

    // Start the EVENT pipeline store: seed each pane's timeline (ring → durable
    // sink → transcript backfill, resolved in Rust), then subscribe to live
    // `overview://event` pushes. Each ingested event that signals visible content
    // changed (a tool completing / a turn ending) triggers an immediate transcript
    // read — replacing the old fixed 1.5s poll.
    events.onEvent = (ev) => {
      if (triggersTranscriptRead(ev.hookEventName)) void refreshActivity();
    };
    let unlistenEvents: (() => void) | undefined;
    void events.start(currentPaneRefs()).then((unlisten) => {
      unlistenEvents = unlisten;
    });

    // Start the ORCHESTRATION EXECUTOR: subscribe to `orchestration://request`
    // (the Rust control socket round-trips a coordinator's toolkit ops here) and
    // perform each op against the pane/launcher/activity stores, replying via the
    // `orchestration_reply` command. Mirrors the other listeners' lifecycle.
    let unlistenExecutor: (() => void) | undefined;
    void executor.start().then((unlisten) => {
      unlistenExecutor = unlisten;
    });

    // Listen for the native right-Command tap gesture (`voice://activate`
    // from the Rust NSEvent monitor) and open the voice panel. The footer mic
    // button is the fallback if the monitor never installs/fires.
    let unlistenVoice: (() => void) | undefined;
    void initVoiceActivation().then((unlisten) => {
      unlistenVoice = unlisten;
    });

    return () => {
      stopWatching?.();
      unlistenSnapshots?.();
      unlistenSubagents?.();
      unlistenEvents?.();
      unlistenExecutor?.();
      unlistenTermClose?.();
      unlistenVoice?.();
      events.onEvent = undefined;
    };
  });

  // The app's app-pane session refs ({sessionId, cwd}), joining each snapshot's
  // Claude session id with its pane cwd from the workspace registry (pure helper).
  function currentSessionRefs(): SessionRef[] {
    return appSessionRefs(snapshots.byPane, (paneId) => workspace.session(paneId).cwd);
  }

  // The app's claude panes as {paneId, sessionId, cwd} — the input to the
  // transcript-activity command. Read straight from the workspace registry (NOT the
  // snapshot): each claude pane was spawned with `--session-id`, so we read its
  // EXACT transcript with no statusline/snapshot dependency and no cwd ambiguity.
  function currentPaneRefs(): PaneRef[] {
    const refs: PaneRef[] = [];
    for (const ws of workspace.workspaces) {
      for (const [paneId, sess] of Object.entries(ws.registry)) {
        if (sess.program === 'claude' && sess.sessionId) {
          refs.push({ paneId, sessionId: sess.sessionId, cwd: sess.cwd });
        }
      }
    }
    return refs;
  }

  // Refresh transcript activity, then ask the titles store to regenerate any
  // session title whose user-messages hash changed (gated + throttled in the store,
  // so this is cheap to call often).
  async function refreshActivity(): Promise<void> {
    const refs = currentPaneRefs();
    if (refs.length === 0) return;
    await activity.refresh(refs);
    titles.refresh(refs, (paneId) => activity.forPane(paneId).userHash, Date.now());
  }

  // The app's set of launched session ids (sorted, de-duped), used to keep the
  // subagents watched-set current as panes come and go.
  const ourSessionIds = $derived(appSessionIds(snapshots.byPane));

  // Keep the SUBAGENTS watched-set current too: whenever the app's session refs
  // change (a new app pane reports a session id, a cwd resolves, or one ends),
  // re-seed the Rust `subagents_for` watcher so it watches exactly our sessions.
  // Keyed on the session ids (sorted, stable) so it only fires on a real change.
  $effect(() => {
    void ourSessionIds; // re-run when the app's session set changes
    void subagents.seed(currentSessionRefs());
  });

  // SAFETY poll for TRANSCRIPT ACTIVITY. Event-driven reads (the `events.onEvent`
  // hook above) do the timely work now — on every tool completion / turn end — so
  // this is only a slow backstop that re-reads content if a triggering event never
  // arrived (e.g. the socket was briefly down). The old fixed 1.5s fast poll is
  // retired in favour of SAFETY_POLL_MS.
  $effect(() => {
    const id = setInterval(() => {
      void refreshActivity();
    }, SAFETY_POLL_MS);
    return () => clearInterval(id);
  });

  // PROJECT GIT poll. Each project's folder is probed for its branch + ahead/
  // behind/dirty (the `git_status_for` command) so the project pane shows its
  // current branch even with no agent running. Reading `projects.list` here both
  // refreshes immediately AND re-runs this effect when a project is added/removed,
  // so a new project is probed at once; a slow interval keeps it fresh thereafter.
  const GIT_POLL_MS = 4000;
  $effect(() => {
    const paths = projects.list.map((p) => p.path);
    void projectGit.refresh(paths);
    const id = setInterval(() => {
      void projectGit.refresh(projects.list.map((p) => p.path));
    }, GIT_POLL_MS);
    return () => clearInterval(id);
  });

  // Keep the EVENT store's seeded set current: whenever the app's session set
  // changes (a pane launched/ended, a cwd resolved), re-seed `events_for` so a
  // newly-launched agent's timeline (and any backfill) is available immediately.
  $effect(() => {
    void ourSessionIds; // re-run when the app's session set changes
    void events.seed(currentPaneRefs());
  });

  // Prune GHOST snapshots: whenever the set of open panes changes (a pane closes,
  // a workspace closes, or one is added/restored), drop any usage snapshot whose
  // pane_id no longer maps to a live pane. Otherwise a closed pane leaves a stale
  // snapshot that shows as a ghost agent, inflates the aggregate cost total, and
  // keeps its dead session in the foreign exclude-set. `allPaneIds()` reads
  // `workspace.workspaces` (+ each registry) reactively, so this re-runs on every
  // such change; `retain` is a no-op (no reactive write) when nothing is stale.
  $effect(() => {
    snapshots.retain(workspace.allPaneIds());
  });

  // AUTO-ARCHIVE TASK AGENTS: a Claude session spawned by an agent task is meant to
  // be fire-and-forget. Once it FINISHES the turn it was launched for and returns to
  // the user (event status → `waiting`/`finished`, with a `UserPromptSubmit` already
  // in its timeline so we don't archive the pre-work idle state), archive it. Reading
  // `events.activityMap()` makes this re-run on every event (incl. a newly-spawned
  // pane's first events); `workspace.allPaneIds()` re-runs it when panes come/go.
  $effect(() => {
    const statusByPane = events.activityMap();
    if (taskAgentPanes.size === 0) return;
    const live = workspace.allPaneIds();
    for (const paneId of [...taskAgentPanes]) {
      if (!live.has(paneId)) {
        taskAgentPanes.delete(paneId); // pane was deleted before it returned
        continue;
      }
      if (!taskAgentReturnedToUser(statusByPane[paneId]?.status, events.timeline(paneId))) {
        continue;
      }
      taskAgentPanes.delete(paneId);
      workspace.closeAgent(paneId);
    }
  });

  // With no workspaces left (first launch, or the last agent closed/exited), the
  // grid would render blank — so fall back to the overview (its empty state). Reads
  // `workspace.workspaces` reactively, so it fires whenever the list empties.
  $effect(() => {
    if (workspace.workspaces.length === 0 && view.isGrid) view.show('overview');
  });

  // NOTE: finished (exited) agents are intentionally NOT auto-closed. They linger
  // in the inbox's "Completed" group so you keep seeing your finished work (and
  // they are remembered across restarts — the layout, including exited claude
  // sessions, is persisted and resumed with `claude --resume`). Close a session
  // explicitly from the inbox (the ✕ in the focus header or the row's right-click
  // menu). This also satisfies "don't auto-advance away to nothing".

  // Active project for the Terminals panel — same precedence as the panel itself
  // (an explicit project-filter selection wins, else the focused agent's project).
  // Used by Cmd-T (new-task dialog), Cmd-Y (new terminal) and Cmd-Tab (focus cycle).
  const terminalsActiveProjectId = $derived(
    activeProjectId({
      focusedId: workspace.active ? workspace.focusedId : '',
      projectIdOf: (id) => workspace.session(id).projectId,
      selectedProjectId:
        projectFilter.selected === ALL || projectFilter.selected === UNASSIGNED
          ? null
          : projectFilter.selected
    })
  );

  // Panel width drag-resize: dragging the left grip leftwards widens the panel.
  function startPanelResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = tasksPanel.width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => tasksPanel.setWidth(startW + (startX - ev.clientX));
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  // Cmd-Y: open a new bare interactive shell in the active project (no command)
  // and focus it. Opens the Terminals panel first so the new terminal is visible.
  function newTerminal() {
    tasksPanel.open = true;
    const pid = terminalsActiveProjectId;
    if (!pid) return;
    const id = projectTasks.launchBareTerminal(pid);
    const pane = projectTasks.bareForProject(pid).find((b) => b.id === id)?.paneId;
    if (pane) {
      lastCycledPaneId = pane;
      focusTerminal(pane); // registry parks the request until the pane mounts
    }
  }

  // Cmd-Tab focus cycle: the focused agent, then the active project's running
  // terminals in order. `lastCycledPaneId` tracks our position so repeated presses
  // walk the ring (falling back to the focused agent when the ring shifts).
  let lastCycledPaneId: string | null = null;
  function focusCycleList(): string[] {
    const list: string[] = [];
    if (workspace.active && workspace.focusedId) list.push(workspace.focusedId);
    const pid = terminalsActiveProjectId;
    if (pid) {
      for (const t of projectTasks.forProject(pid)) {
        const rt = projectTasks.runtime[t.id];
        if (rt?.running) list.push(rt.paneId);
      }
      // Bare ⌘Y shells are running terminals too — the panel shows them and the badge
      // counts them — so the cycle must reach them, not only command-backed task-defs.
      // (Every "new terminal" entry point — ⌘Y, the panel ＋, the git-failure opener —
      // creates a bare shell, so omitting these left the ring with just the agent.)
      for (const b of projectTasks.bareForProject(pid)) {
        if (b.running) list.push(b.paneId);
      }
    }
    return list;
  }
  function cycleFocus() {
    const list = focusCycleList();
    if (list.length <= 1) return;
    tasksPanel.open = true; // terminals must be mounted/visible to take focus
    const anchor = lastCycledPaneId && list.includes(lastCycledPaneId)
      ? lastCycledPaneId
      : workspace.focusedId;
    const cur = list.indexOf(anchor);
    const next = list[(cur + 1 + list.length) % list.length];
    lastCycledPaneId = next;
    focusTerminal(next);
    scrollTerminalToBottom(next);
  }

  // Keyboard shortcuts (macOS):
  //   Cmd-N            open the session LAUNCHER (folder picker + recents +
  //                    optional prompt + placement). The deliberate, full-flow
  //                    "new session" entry point.
  //   Cmd-T            open the create-task dialog for the active project.
  //   Cmd-Y            open a new bare interactive terminal in the Terminals panel.
  //   Cmd-Tab          cycle focus across the active agent + its project's terminals.
  //   Cmd-W            close the focused pane
  //   Cmd-]            focus next (cyclic, DFS +1)
  //   Cmd-[            focus prev (cyclic, DFS -1)
  //   Alt-Arrow        directional focus (spatial neighbor)
  function onKeydown(e: KeyboardEvent) {
    const meta = e.metaKey;
    const alt = e.altKey;
    const key = e.key;

    // A confirmation modal is the TOPMOST surface and owns the keyboard while open:
    // Esc cancels it (its own handler only fires when focus is inside the dialog, so
    // cover it here too) and we block every shortcut beneath so nothing fires under
    // the "are you sure?" dialog. Checked first since it can sit over any other view.
    if (confirmModal.open) {
      if (key === 'Escape') {
        e.preventDefault();
        confirmModal.close();
      }
      return;
    }

    // Help overlay: Cmd-/ toggles it from anywhere; bare ? opens it too, but only
    // when NOT typing into a field/terminal, so a literal "?" still reaches prompts
    // and the xterm terminal (Cmd-/ is the always-safe path). Handled before the
    // per-view guards so help works in every view; `help.open` below then blocks the
    // pane shortcuts beneath the modal (the modal owns its own Esc).
    if (meta && key === '/') {
      e.preventDefault();
      help.toggle();
      return;
    }
    if (key === '?' && !meta && !alt && !e.ctrlKey && !isEditableTarget(e.target)) {
      e.preventDefault();
      help.show();
      return;
    }
    // While the help modal is open it owns the keyboard: Esc closes it (the modal's
    // own handler only fires when focus is inside it, so cover it here too) and we
    // block the pane shortcuts beneath.
    if (help.open) {
      if (key === 'Escape') {
        e.preventDefault();
        help.close();
      }
      return;
    }

    // While the launcher or the task dialog is open it owns the keyboard (its own
    // Esc / Cmd-Enter); don't let app pane shortcuts (⌘T/⌘Y/⌘N/…) fire underneath.
    if (launcher.open || taskDialog.open) return;

    // Cmd-N starts a new session: straight into the selected project (no popup), or
    // the launcher when no single project is in focus. Same path as the inbox "+".
    if (meta && (key === 'n' || key === 'N')) {
      e.preventDefault();
      // Fire-and-forget: startNewSession is async (it may create a worktree first).
      void startNewSession();
      return;
    }

    // Cmd-J toggles the right-docked Terminals panel (process-independent: hiding
    // never kills a running terminal). Works in every view, like Cmd-N.
    if (meta && (key === 'j' || key === 'J')) {
      e.preventDefault();
      tasksPanel.toggle();
      return;
    }

    // Cmd-T opens the create-task dialog for the active project (every view).
    if (meta && (key === 't' || key === 'T')) {
      e.preventDefault();
      taskDialog.showCreate(terminalsActiveProjectId);
      return;
    }

    // Cmd-Y opens a new bare interactive terminal in the Terminals panel.
    if (meta && (key === 'y' || key === 'Y')) {
      e.preventDefault();
      newTerminal();
      return;
    }

    // Cmd-Tab cycles focus across the active agent and its project's terminals.
    // NOTE: macOS reserves Cmd-Tab for the app switcher at the system level, so this
    // may not reach the webview on macOS; it works where the OS lets the key through.
    if (meta && key === 'Tab') {
      e.preventDefault();
      cycleFocus();
      return;
    }

    // Cmd-O inserts a picked file's quoted path into the FOCUSED terminal at the
    // cursor. A global shortcut (works in every view, incl. while xterm holds
    // focus) — placed BEFORE the grid-only gate below so it isn't made inert.
    // Exclude Alt/Ctrl so only the bare Cmd-O combo fires (stray Cmd-Opt-O /
    // Cmd-Ctrl-O fall through). `insertFilenameInto` checks the focused
    // handle BEFORE opening the picker, so this is a clean no-op (no dialog) when
    // no terminal is focused; preventDefault keeps the keystroke off the PTY and
    // suppresses the webview's native "Open file" accelerator.
    if (meta && !alt && !e.ctrlKey && (key === 'o' || key === 'O')) {
      e.preventDefault();
      void insertFilenameInto(focusedTerminalHandle());
      return;
    }

    // The remaining shortcuts MUTATE the active workspace's pane layout/focus, so
    // they are GRID-ONLY. The grid is no longer a navigable top-level view (the
    // inbox shows each agent's live terminal in its focus pane), so `view.isGrid`
    // is never true and these stay inert — the grid surface persists only as the
    // hidden home the inbox teleports terminals out of. Cmd-N (launcher) above
    // still works in every view.
    if (!view.isGrid) return;

    // Ignore the remaining (pane) shortcuts before the store is seeded.
    if (!workspace.active) return;

    if (meta && (key === 'w' || key === 'W')) {
      e.preventDefault();
      workspace.closeFocused();
      return;
    }
    if (meta && key === ']') {
      e.preventDefault();
      workspace.focusNext();
      return;
    }
    if (meta && key === '[') {
      e.preventDefault();
      workspace.focusPrev();
      return;
    }
    if (alt && key.startsWith('Arrow')) {
      const dir = arrowDir(key);
      if (dir) {
        e.preventDefault();
        workspace.focusDirectional(dir, rectsSnapshot());
      }
      return;
    }
  }

  // True when the event target is a text-entry surface (an input/textarea/
  // contenteditable, or the xterm terminal — which captures keys via a hidden
  // <textarea>). Used to keep the bare-? help shortcut from hijacking a typed "?".
  function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }

  function arrowDir(key: string): SpatialDir | null {
    switch (key) {
      case 'ArrowLeft':
        return 'left';
      case 'ArrowRight':
        return 'right';
      case 'ArrowUp':
        return 'up';
      case 'ArrowDown':
        return 'down';
      default:
        return null;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <!-- Custom title bar. With macOS titleBarStyle "Overlay" the native traffic
       lights float over the left of this bar, so we pad-left to clear them and
       make the whole bar a drag region instead of drawing our own dots. -->
  <header class="titlebar" data-tauri-drag-region>
    <!-- The ENTIRE bar is a drag region. Tauri only starts a drag when the
         mousedown TARGET carries `data-tauri-drag-region`, so every layout cell
         gets it too (otherwise their empty areas are dead zones). Interactive
         bits opt out via pointer-events (logo/title are :none so they pass the
         drag through; the usage meter's hover targets keep pointer events). -->
    <div class="tb-left" data-tauri-drag-region></div>
    <div class="tb-center" data-tauri-drag-region>
      <img class="logo" src="/logomark.svg" alt="" aria-hidden="true" />
      <span class="title">Agent Mission Control</span>
    </div>
    <div class="tb-right" data-tauri-drag-region>
      <!-- Opt back into pointer events (the bar is a drag region) so the buttons are
           clickable. Gear opens Settings; "?" opens the shortcuts modal (⌘/ and ?). -->
      <button
        class="tb-btn"
        class:active={tasksPanel.open}
        aria-label="Toggle terminals panel"
        aria-pressed={tasksPanel.open}
        use:tooltip={{ text: 'Terminals (⌘J)', placement: 'bottom' }}
        onclick={() => tasksPanel.toggle()}
      >
        <Icon name="panel-right" size={14} />
        {#if projectTasks.runningCount > 0}
          <span class="tb-badge" aria-label={`${projectTasks.runningCount} running`}>
            {projectTasks.runningCount}
          </span>
        {/if}
      </button>
      <button class="tb-btn" aria-label="Settings" use:tooltip={{ text: 'Settings', placement: 'bottom' }} onclick={() => settingsModal.show()}>
        <Icon name="settings" size={14} />
      </button>
      <button class="help-btn" aria-label="Keyboard shortcuts" use:tooltip={{ text: 'Keyboard shortcuts (⌘/)', placement: 'bottom' }} onclick={() => help.show()}>?</button>
    </div>
  </header>

  <!-- Hold off rendering the workspace area (grid + overview + workflow) until the
       persisted layout has loaded (or fallen back to fresh), so we never flash a
       throwaway workspace whose PTYs we'd immediately tear down. The title bar
       above stays visible throughout; this only gates the body/views. -->
  {#if restored}
  <!-- Content row: the active view (grid or overview) on the left, the right-docked
       Terminals panel on the right. Laid out as a row so the panel sits BESIDE
       whatever view is active (the overview is the normal top-level view; the grid
       stays mounted-but-hidden). The footer stays full-width below this row. -->
  <div class="content-row">
  <div class="views">
  <!-- The terminal-grid surface (rail + panes + usage bar). Kept MOUNTED at all
       times so every workspace's xterm/PTY survives a view switch; hidden (not
       unmounted) while the Overview is the active top-level view. -->
  <div class="grid-view" class:hidden={!view.isGrid}>
  <div class="body">
    <!-- Left vertical session rail (fixed width). Switches the active workspace;
         never renders panes itself. -->
    <SessionRail />

    <!-- The workspace area. EVERY workspace's PaneNode stays mounted; inactive
         ones are display:none so their xterm + PTY survive untouched. Only the
         active workspace is interactive and feeds WebGL/rects. -->
    <main class="surface" use:portal={surfaceSlot.target}>
      {#each workspace.workspaces as ws (ws.id)}
        {@const isActive = ws.id === workspace.activeWorkspaceId}
        <div class="workspace" class:hidden={!isActive}>
          <PaneNode node={ws.ws.root} workspaceId={ws.id} activeWorkspace={isActive} />
        </div>
      {/each}
    </main>
  </div>

  </div>

  <!-- The INBOX overview surface. Rendered only while overview is the active
       top-level view; the grid above stays mounted (hidden) so its PTYs are
       untouched. The inbox reads the snapshots + workspace + subagent stores
       (pure view-model math) and teleports the live grid surface into its focus
       pane — no PTY is ever double-spawned. -->
  {#if view.isOverview}
    <Inbox />
  {/if}
  </div><!-- /.views -->

  <!-- The right-docked Terminals panel. Kept MOUNTED at all times and hidden via
       CSS when toggled off, so running terminal PTYs survive a hide untouched
       (terminals-panel spec). Takes zero width when closed. -->
  <aside
    class="terminals-dock"
    class:hidden={!tasksPanel.open}
    style="flex-basis: {tasksPanel.width}px;"
  >
    <!-- Drag the left edge to resize the panel width (persisted). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="terminals-grip"
      use:tooltip={'Drag to resize'}
      onpointerdown={startPanelResize}
    ></div>
    <RunningTasksPanel />
  </aside>
  </div><!-- /.content-row -->

  <!-- The persistent footer, OUTSIDE grid-view so it shows on EVERY surface
       (overview + grid), pinned full-width at the bottom of the app column:
       project chip + 5h/7d limit bars (left) | git + context bar (right). All
       math is in the pure `footerView`. -->
  <AppFooter />
  {:else}
    <!-- Minimal splash while the persisted layout is restoring; replaced by the
         workspace area as soon as `restored` flips true. -->
    <div class="restoring">Restoring…</div>
  {/if}
</div>

<!-- Single app-wide pane context menu (right-click). Position:fixed, so it can
     live at the markup root. -->
<PaneContextMenu />

<!-- The session launcher modal. Opened from the rail "+ new session" row, the
     pane context-menu "New Session" item, and the Cmd-N shortcut (all via the
     shared `launcher` store). Position:fixed backdrop, so it lives at the root. -->
<Launcher />
<!-- The create/edit task dialog. Opened from the Tasks launcher header ＋, a task
     row's edit action, and the ⌘T shortcut (all via the shared `taskDialog`
     store). Position:fixed backdrop, so it lives at the root, single-instance. -->
<TaskDialog />
<!-- Transient toast notifications (e.g. "<task> completed" on task success). -->
<Toast />
<HelpModal />
<SettingsModal />
<ConfirmModal />
<VoicePanel />
<!-- First-launch model download gate: a full-screen takeover shown only while the
     on-device models the current voice selection needs are missing (and not skipped
     this session). Rendered last so it overlays the workspace. -->
{#if onboarding.visible}
  <ModelOnboarding />
{/if}

<style>
  .app {
    /* Positioned ancestor (position:relative) and flex column for the app body.
       Without position:relative, any absolutely-positioned descendants (e.g.
       workspace tiles) would resolve their containing block to the viewport and
       cover the title bar. The flex column stacks title bar above the body. */
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--space-850);
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 40px;
    flex: 0 0 40px;
    padding: 0 14px 0 80px;
    background: var(--space-900);
    border-bottom: 1px solid var(--line-subtle);
    user-select: none;
    -webkit-user-select: none;
  }

  /* Left (logo) and right (usage meter) take equal flex so the centered title
     sits in the true horizontal center of the bar. */
  .tb-left {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .tb-center {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .tb-right {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .help-btn {
    flex: none;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-full);
    background: transparent;
    color: var(--fg-3);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    /* The title bar is a drag region (pointer-events suppressed on its children);
       re-enable here so the button is hoverable/clickable. */
    pointer-events: auto;
    transition:
      color var(--dur-fast),
      border-color var(--dur-fast),
      background var(--dur-fast);
  }
  .help-btn:hover {
    color: var(--fg-1);
    border-color: var(--line-strong);
    background: rgba(255, 255, 255, 0.05);
  }

  /* Title-bar icon button (settings gear). Matches the help button's footprint and
     hover, but square-ish with a rounded icon fit. */
  .tb-btn {
    position: relative;
    flex: none;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-full);
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
    pointer-events: auto;
    transition:
      color var(--dur-fast),
      border-color var(--dur-fast),
      background var(--dur-fast);
  }
  .tb-btn:hover {
    color: var(--fg-1);
    border-color: var(--line-strong);
    background: rgba(255, 255, 255, 0.05);
  }
  /* Active (panel open) state for the terminals toggle. */
  .tb-btn.active {
    color: var(--fg-1);
    border-color: var(--line-strong);
    background: rgba(255, 255, 255, 0.08);
  }
  /* Running-terminal count badge on the toggle (visible even when panel hidden). */
  .tb-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    display: grid;
    place-items: center;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    color: #06080c;
    background: #3ccb7f;
    border-radius: 7px;
    pointer-events: none;
  }

  .logo {
    width: 18px;
    height: 18px;
    flex: none;
    pointer-events: none;
  }

  .title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-2);
    letter-spacing: -0.01em;
    pointer-events: none;
  }

  /* The grid-view wrapper fills the region below the title bar (body + usage bar)
     as a flex column. It is no longer a navigable view — it stays mounted but
     hidden (display:none) as the home the inbox teleports each agent's live
     terminal out of, so every workspace's xterm/PTY survives untouched. */
  /* The horizontal content row: active view (fills) + right-docked panel. */
  .content-row {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }
  /* The view column holds the (mounted) grid + the overview; one is visible. It
     fills the remaining width to the left of the Terminals dock. */
  .views {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .grid-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grid-view.hidden {
    display: none;
  }

  /* Minimal "Restoring…" splash shown until the persisted layout resolves. Fills
     the area below the title bar and centers a dim label. */
  .restoring {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-size: 13px;
    font-family: var(--font-mono);
  }


  /* Below the title bar: rail (fixed) + workspace area (fills the rest). */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  /* The session rail occupies a fixed left column. */
  .body :global(nav.rail) {
    flex: 0 0 200px;
    width: 200px;
  }

  .surface {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    position: relative;
    background: var(--space-850);
  }

  /* Each workspace fills the surface; inactive ones are hidden but stay mounted
     (display:none keeps the xterm + PTY alive without painting/layout cost). */
  .workspace {
    position: absolute;
    inset: 0;
  }
  .workspace.hidden {
    display: none;
  }

  /* The right-docked Terminals panel. Fixed-width column to the right of the
     surface; zero space (display:none) when toggled off. Stays mounted so its
     PTYs survive a hide. */
  .terminals-dock {
    flex: 0 0 auto; /* basis set inline from tasksPanel.width (drag-resizable) */
    min-width: 0;
    height: 100%;
    position: relative;
  }
  .terminals-dock.hidden {
    display: none;
  }
  /* Left-edge resize grip straddling the panel's border. */
  .terminals-grip {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
    z-index: 5;
  }
  .terminals-grip:hover {
    background: var(--blue-500);
    opacity: 0.5;
  }
</style>
