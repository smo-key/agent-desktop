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
  import WhatsNewModal from '$lib/changelog/WhatsNewModal.svelte';
  import { whatsNew } from '$lib/changelog/whatsNewStore.svelte';
  import { loadSettings } from '$lib/settings/persist';
  import { confirmModal } from '$lib/ui/confirmStore.svelte';
  import { settingsModal } from '$lib/ui/settingsStore.svelte';
  import { openWith } from '$lib/settings/openWith.svelte';
  import { voice } from '$lib/settings/voice.svelte';
  import { autoAdvance } from '$lib/settings/autoAdvance.svelte';
  import { compactMode } from '$lib/settings/compactMode.svelte';
  import { sessionGrouping } from '$lib/settings/sessionGrouping.svelte';
  import { keepAwake, shouldKeepAwake } from '$lib/settings/keepAwake.svelte';
  import { KeepAwakeDriver } from '$lib/settings/keepAwakeDriver';
  import { shellSettings } from '$lib/settings/shell.svelte';
  import { agentSettings } from '$lib/settings/agent.svelte';
  import { subagentsVisible } from '$lib/settings/subagentsVisible.svelte';
  import { uiPrefs } from '$lib/settings/uiPrefs.svelte';
  import { titleSettings } from '$lib/settings/titles.svelte';
  import VoicePanel from '$lib/voice/VoicePanel.svelte';
  import ModelOnboarding from '$lib/onboarding/ModelOnboarding.svelte';
  import { onboarding } from '$lib/onboarding/onboarding.svelte';
  import { initVoiceActivation } from '$lib/voice/activation';
  import Icon from '$lib/icons/Icon.svelte';
  import { tooltip } from '$lib/ui/tooltip';
  import { startNewSession, startNewWorktreeSession } from '$lib/launcher/newSession';
  import { shortcuts } from '$lib/settings/shortcuts.svelte';
  import { showTerminalsDock, terminalsCombined } from '$lib/tasks/placement';
  import { sessionCwd, workspace } from '$lib/layout/workspace.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { paneWorktreesToForget, worktreeCwdToAdopt } from '$lib/launcher/worktreeArgs';
  import { insertFilenameInto, focusedTerminalHandle } from '$lib/layout/insertFilename';
  import { initFileDrop } from '$lib/layout/fileDrop';
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
  import { projectForId, projectLabel } from '$lib/projects/projects';
  import { setGitTerminalOpener } from '$lib/projects/projectGitActions';
  import { setAgentTaskLauncher } from '$lib/projects/prActions';
  import { buildLaunchPlan } from '$lib/launcher/plan';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { ALL, UNASSIGNED } from '$lib/projects/projectRollup';
  import { focusTerminal, scrollTerminalToBottom } from '$lib/layout/terminals';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { events } from '$lib/overview/events.svelte';
  import { executor } from '$lib/orchestration/executor.svelte';
  import { checkForUpdateOnLaunch, startUpdatePolling } from '$lib/updates/checkForUpdate';
  import { updateStore } from '$lib/updates/updateStore.svelte';
  import { titles } from '$lib/overview/titles.svelte';
  import { triggersTranscriptRead, SAFETY_POLL_MS } from '$lib/overview/poll';
  import { appSessionRefs } from '$lib/overview/sessionRefs';
  import { type SpatialDir } from '$lib/layout/tree';
  // Needs-input alerts (capability `needs-input-alerts`): the alert driver lives here
  // on the always-mounted route (the Inbox is mounted only in overview mode), so a
  // sound/desktop alert can fire whether the user is in the overview or driving an
  // agent in the grid. See design D7b/D7c.
  import { isWorking } from '$lib/overview/roster';
  import { toNavWorkspaces } from '$lib/overview/rosterInputs';
  import { roster } from '$lib/overview/rosterStore.svelte';
  import { allAgentPaneRefs, isLivePane, liveAgentPaneRefs } from '$lib/overview/paneRefs';
  import { activationIntent } from '$lib/overview/activate';
  import { focusRequest } from '$lib/overview/focusRequest.svelte';
  import { listen } from '@tauri-apps/api/event';
  import { windowFocus } from '$lib/overview/windowFocus.svelte';
  import { focusAgent } from '$lib/overview/focusAgent.svelte';
  import { alerts } from '$lib/overview/alerts.svelte';
  import { notifications } from '$lib/settings/notifications.svelte';

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
    // Hydrate durable UI-layout prefs (project-pane collapse, terminals width,
    // tasks-launcher split, project filter, lane order) from the `ui` settings
    // slice. Seeded with defaults so the UI renders immediately; this corrects
    // them reactively once loaded. Kept on disk (not localStorage) so an abrupt
    // restart doesn't forget the layout.
    void uiPrefs.hydrate();
    // Check for an in-app update (desktop-auto-update spec). Best-effort and
    // non-blocking: when a newer version is published it downloads + stages in the
    // background with NO dialog, surfacing via the title-bar pill; a silent no-op
    // offline / outside the Tauri runtime.
    void checkForUpdateOnLaunch();
    // Then keep re-checking once an hour for the lifetime of the session — same
    // background-staging path as launch, surfaced only via the title-bar pill. The
    // returned stop fn (a no-op outside Tauri) is cleared on teardown below.
    const stopUpdatePolling = startUpdatePolling();
    // Release notes: open the What's new dialog once per version after an update
    // (whats-new-dialog spec). Reads settings.json for the `whatsNew.seenVersion`
    // slice; a fresh install or a dev build stays quiet. Best-effort, non-blocking.
    void loadSettings().then((settings) => whatsNew.maybeShowOnLaunch(settings));
    // Load the user's open-with preferences (seeds defaults on first run).
    void openWith.load();
    // Load session-title preferences (the opt-in cloud title fallback).
    void titleSettings.load();
    // Load the auto-advance focus preference (opt-in; defaults OFF).
    void autoAdvance.load();
    // Load the sessions-panel density preference (defaults to full three-line rows).
    void compactMode.load();
    // Load the sessions-panel grouping preference (defaults to status lanes).
    void sessionGrouping.load();
    // Load the keep-computer-awake preference (defaults to never).
    void keepAwake.load();
    // Resolve the platform default shell from the backend and load the user's
    // shell preference. The layout restore below AWAITS this: until it resolves,
    // `defaultShell()` still reports the Unix default, and restoring a Windows
    // layout against it would rewrite every saved `pwsh` to `/bin/zsh` — spawning
    // dead panes AND persisting the mangled value back over the good one.
    const shellReady = shellSettings.load();
    // Load the agent-backend preference (Claude / Copilot for new sessions) and
    // probe whether the selected CLI is installed (agent-backends).
    void agentSettings.load();
    // Load the subagents-visibility preference (defaults ON / subagents shown).
    void subagentsVisible.load();
    // Load the user's custom keyboard-shortcut bindings (defaults until loaded).
    void shortcuts.load();
    // Load the needs-input alert channel modes (opt-in; both default OFF / silent).
    void notifications.load();
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
    void projects.load().then(() => {
      projectTasks.load();
      // Initial background remote fetch, once the project list is populated (the
      // recurring interval below is mount-once and at mount the list is still
      // empty). Refresh status after so the advanced ahead/behind surfaces promptly
      // — "shortly after launch", not a full FETCH_POLL_MS cadence later.
      const paths = projects.active.map((p) => p.path);
      void projectGit.fetchRemotes(paths).then(() => projectGit.refresh(paths));
    });
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
    // Gated on `shellReady` (never rejects) so pane programs resolve against the
    // real platform default rather than the pre-hydration placeholder.
    void shellReady
      .then(restorePersistedLayout)
      // BEFORE `restored` flips: flipping it renders the panes, and a pane whose
      // adopted worktree dir was removed would spawn into the missing directory
      // (an outright spawn failure) before the clear landed — and PaneNode keys
      // the terminal on the pane id, so a later clear cannot remount it.
      .then(forgetRemovedWorktrees)
      .then(() => {
        restored = true;
        // Seed restored agents' titles from the durable cache synchronously, so
        // the cards render their real titles immediately rather than flashing
        // their "Session N" fallback until the first (async) activity poll lands.
        titles.hydrate(currentPaneRefs());
        // Prime TRANSCRIPT ACTIVITY once for EVERY restored agent pane — closed ones
        // included, so an archived row shows its last summary — then refresh the
        // LIVE panes. Must run AFTER restore: before it the registries are empty.
        void activity.refresh(currentPaneRefs()).then(() => refreshActivity());
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

    // Transcript activity is primed once the layout has restored (above); from
    // then on event-driven reads (below) and the slow safety poll refresh only
    // the LIVE panes.

    // Start the EVENT pipeline store: seed each pane's timeline (ring → durable
    // sink → transcript backfill, resolved in Rust), then subscribe to live
    // `overview://event` pushes. Each ingested event that signals visible content
    // changed (a tool completing / a turn ending) triggers an immediate transcript
    // read — replacing the old fixed 1.5s poll.
    events.onEvent = (ev) => {
      if (triggersTranscriptRead(ev.hookEventName)) void refreshActivity();
    };
    let unlistenEvents: (() => void) | undefined;
    void events.start(livePaneRefs()).then((unlisten) => {
      unlistenEvents = unlisten;
    });

    // Start the ORCHESTRATION EXECUTOR: subscribe to `orchestration://request`
    // (the Rust control socket round-trips the MCP toolkit's ops here) and
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

    // Listen for a clicked needs-input notification (`agent-notification-activated`
    // from the custom macOS notify path; capability `alert-click-focus`). Raise +
    // focus the window, switch to the overview, and — when a live leaf still carries
    // the alerting agent's pane — request the inbox select it. A dead pane focuses
    // the window only (the inbox no-ops the request).
    let unlistenNotifyClick: (() => void) | undefined;
    void listen<{ paneId: string }>('agent-notification-activated', (ev) => {
      const paneId = ev.payload?.paneId;
      void getCurrentWindow()
        .show()
        .then(() => getCurrentWindow().unminimize())
        .then(() => getCurrentWindow().setFocus())
        .catch(() => {});
      view.show('overview');
      if (!paneId) return;
      const intent = activationIntent(paneId, toNavWorkspaces(workspace.workspaces));
      if (intent.selectPaneId) focusRequest.request(intent.selectPaneId);
    }).then((un) => {
      unlistenNotifyClick = un;
    });

    // Drag-drop OS files onto a session (terminal-file-drop): native drag-drop
    // hands us real paths + the cursor position; images paste as inline images,
    // other files insert as quoted paths, drops elsewhere are inert.
    let unlistenFileDrop: (() => void) | undefined;
    void initFileDrop().then((un) => {
      unlistenFileDrop = un;
    });

    return () => {
      stopUpdatePolling();
      stopWatching?.();
      unlistenSnapshots?.();
      unlistenSubagents?.();
      unlistenEvents?.();
      unlistenExecutor?.();
      unlistenTermClose?.();
      unlistenVoice?.();
      unlistenNotifyClick?.();
      unlistenFileDrop?.();
      events.onEvent = undefined;
    };
  });

  // The app's app-pane session refs ({sessionId, cwd}), joining each snapshot's
  // Claude session id with its pane cwd from the workspace registry (pure helper).
  function currentSessionRefs(): SessionRef[] {
    return appSessionRefs(snapshots.byPane, (paneId) => {
      // ANY workspace, not just the active one: `session()` fabricates a
      // login-shell default for a pane outside it, which would hand the subagent
      // watcher `{cwd: null, program: '/bin/zsh'}` — silently dropping the watch
      // (and mislabelling a copilot pane) whenever the user switches session tabs.
      const sess = workspace.sessionAnywhere(paneId);
      // A CLOSED (archived) agent resolves to null so it LEAVES the watched-set:
      // its files never change, and every watched session costs the Rust
      // watcher IO on each recompute (see paneRefs.ts).
      if (!isLivePane(sess)) return null;
      // The ADOPTED worktree dir when there is one: the subagent reader locates a
      // session's sidecars purely by cwd, so a `--worktree` session lists none
      // unless we hand it the dir the session actually runs in.
      return { cwd: sessionCwd(sess!), program: sess!.program };
    });
  }

  /**
   * Drop any ADOPTED worktree dir that no longer exists (session-launcher: "A
   * worktree session resumes in its worktree"). A worktree is commonly removed
   * once its branch merges, and the dir is persisted — so a restored pane would
   * otherwise keep trying to spawn in a missing directory forever. Existence is
   * checked with `resolve_path`, which canonicalizes and so answers `null` for a
   * path that is gone. Runs once, right after restore.
   */
  async function forgetRemovedWorktrees(): Promise<void> {
    const panes: { paneId: string; worktreeCwd?: string }[] = [];
    for (const ws of workspace.workspaces) {
      for (const [paneId, sess] of Object.entries(ws.registry)) {
        if (sess.worktreeCwd) panes.push({ paneId, worktreeCwd: sess.worktreeCwd });
      }
    }
    if (panes.length === 0) return;
    const alive = new Set<string>();
    await Promise.all(
      panes.map(async (p) => {
        try {
          const resolved = await invoke<string | null>('resolve_path', {
            cwd: null,
            token: p.worktreeCwd
          });
          if (resolved) alive.add(p.worktreeCwd as string);
        } catch {
          // Treat an IPC failure as "still there": never discard a good dir over a
          // transient error — a missing one is caught on the next launch.
          alive.add(p.worktreeCwd as string);
        }
      })
    );
    for (const paneId of paneWorktreesToForget(panes, (dir) => alive.has(dir))) {
      workspace.clearWorktreeCwd(paneId);
    }
  }

  // The app's claude panes as {paneId, sessionId, cwd} — the input to the
  // transcript-activity command. Read straight from the workspace registry (NOT the
  // snapshot): each claude pane was spawned with `--session-id`, so we read its
  // EXACT transcript with no statusline/snapshot dependency and no cwd ambiguity.
  /** EVERY agent pane (closed included) — for one-shot in-memory seeding only. */
  function currentPaneRefs(): PaneRef[] {
    return allAgentPaneRefs(workspace.workspaces);
  }

  /** The LIVE agent panes — what every clocked/IO-bound poller reads (see paneRefs.ts). */
  function livePaneRefs(): PaneRef[] {
    return liveAgentPaneRefs(workspace.workspaces);
  }

  // Refresh transcript activity, then ask the titles store to regenerate any
  // session title whose user-messages hash changed (gated + throttled in the store,
  // so this is cheap to call often).
  async function refreshActivity(): Promise<void> {
    const refs = livePaneRefs();
    if (refs.length === 0) return;
    await activity.refresh(refs);
    titles.refresh(refs, (paneId) => activity.forPane(paneId).userHash, Date.now());
  }

  // The app's set of launched session ids (sorted, de-duped), used to keep the
  // subagents watched-set current as panes come and go.
  const ourSessionIds = $derived(appSessionIds(snapshots.byPane));

  // ADOPT a worktree session's real working dir (session-launcher: "A worktree
  // session resumes in its worktree"). `claude --worktree` creates the worktree
  // itself, so the pane was spawned in the project folder and only the running
  // session knows where it ended up — it reports that dir in its snapshot. The
  // rule (`worktreeCwdToAdopt`) adopts it ONCE, so a session that later `cd`s
  // elsewhere never drags the pane's dir with it. Runs off the snapshot map, so a
  // pane is adopted as soon as its first statusline write lands.
  $effect(() => {
    for (const [paneId, snap] of Object.entries(snapshots.byPane)) {
      // ANY workspace: the snapshot map spans them all, and `session()` would
      // fabricate a login-shell pane for one outside the active workspace — so a
      // worktree session launched and then left in a background tab would never be
      // adopted, and would later adopt whatever dir it had `cd`ed to by the time
      // its tab came forward.
      const sess = workspace.sessionAnywhere(paneId);
      if (!sess) continue;
      const adopt = worktreeCwdToAdopt(sess, snap);
      if (adopt) workspace.adoptWorktreeCwd(paneId, adopt);
    }
  });

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
  // current branch even with no agent running. Only ACTIVE projects are probed —
  // an archived project's folder is left alone until it is unarchived. Reading
  // `projects.active` here both refreshes immediately AND re-runs this effect when
  // a project is added/removed/archived, so a new project is probed at once; a
  // slow interval keeps it fresh thereafter.
  const GIT_POLL_MS = 4000;
  $effect(() => {
    const paths = projects.active.map((p) => p.path);
    void projectGit.refresh(paths);
    const id = setInterval(() => {
      void projectGit.refresh(projects.active.map((p) => p.path));
    }, GIT_POLL_MS);
    return () => clearInterval(id);
  });

  // PROJECT REMOTE FETCH (background). The fast poll above reads ahead/behind from
  // LOCAL refs (`@{upstream}`), which only advance on `git fetch` — so without a
  // fetch the "commits to pull" count is frozen at the last fetch. Refresh each
  // project's remote-tracking refs on a SLOW background clock (the `git_fetch_for`
  // command: bounded, parallel, best-effort, read-only, non-interactive in Rust),
  // then re-run the status poll so the advanced refs surface promptly. Kept
  // SEPARATE from GIT_POLL_MS so the local status stays fast and never blocks on
  // the network.
  //
  // This effect owns ONLY the recurring interval, and reads no rune synchronously,
  // so it mounts ONCE — unlike the local status poll above, an immediate re-fetch
  // on every `projects.list` reassignment (drag-reorder, edit,
  // reload) would be an off-schedule network fetch storm. The interval re-reads the
  // live list each tick, so a newly added project is picked up within one cycle (and
  // its LOCAL branch/status already shows at once via the fast 4s poll). The INITIAL
  // fetch is kicked off in onMount once `projects.load()` resolves — at mount time
  // the list is still empty, so an initial fetch here would fetch nothing.
  const FETCH_POLL_MS = 180000;
  $effect(() => {
    const id = setInterval(() => {
      const paths = projects.active.map((p) => p.path);
      void projectGit.fetchRemotes(paths).then(() => projectGit.refresh(paths));
    }, FETCH_POLL_MS);
    return () => clearInterval(id);
  });

  // Keep the EVENT store's seeded set current: whenever the app's session set
  // changes (a pane launched/ended, a cwd resolved), re-seed `events_for` so a
  // newly-launched agent's timeline (and any backfill) is available immediately.
  $effect(() => {
    void ourSessionIds; // re-run when the app's session set changes
    void events.seed(livePaneRefs());
  });

  // SAFETY RE-SEED: the live `overview://event` listener can miss a push, and a
  // frontend-only synthetic interrupt Stop can outlive an interrupt that did not
  // actually stop the agent — either way the event timeline diverges from the
  // authoritative durable sink with no other reconciliation, pinning the row in the
  // wrong lane indefinitely (event-status overrides the live PTY heuristic). Re-seed
  // on a slow interval (mirrors the transcript safety poll) so a diverged status
  // self-heals within EVENT_RESEED_MS. `seed()` MERGES (keeps strictly-newer live
  // events and a still-newest synthetic Stop, drops a superseded one) and swallows
  // errors, so this is cheap, idempotent, and best-effort.
  const EVENT_RESEED_MS = 5000;
  $effect(() => {
    const id = setInterval(() => void events.seed(livePaneRefs()), EVENT_RESEED_MS);
    return () => clearInterval(id);
  });

  // Prune GHOST snapshots: whenever the set of open panes changes (a pane closes,
  // a workspace closes, or one is added/restored), drop any usage snapshot whose
  // pane_id no longer maps to a live pane. Otherwise a closed pane leaves a stale
  // snapshot that shows as a ghost agent, inflates the aggregate cost total, and
  // keeps its dead session in the foreign exclude-set. `allPaneIds()` reads
  // `workspace.workspaces` (+ each registry) reactively, so this re-runs on every
  // such change; `retain` is a no-op (no reactive write) when nothing is stale.
  $effect(() => {
    const live = workspace.allPaneIds();
    snapshots.retain(live);
    // The activity map merges per pane now (closed panes keep their seeded
    // summary), so a pane REMOVED from every workspace must be dropped here or
    // the map grows with every pane ever opened.
    activity.retain(live);
  });

  // NEEDS-INPUT ALERTS driver (capability `needs-input-alerts`). Built off the same
  // module singletons the Inbox roster uses, on its own 1s clock so a working→waiting
  // flip is detected promptly. `alerts.process` fires the sound/desktop channels for
  // agents that JUST entered "Needs input" (each per its own mode). Driven ONLY here
  // (single source, always mounted) so no alert ever fires twice and alerts keep
  // working in grid view (the Inbox is mounted only in overview mode).
  // The SHARED roster + its 1 s clock (rosterStore): one derivation serves the
  // alerts driver, the keep-awake driver, and the Inbox.
  $effect(() => roster.start());
  const alertNowMs = $derived(roster.nowMs);
  // Track OS window focus + visibility while mounted (the route is the app root).
  $effect(() => windowFocus.start());
  const alertRows = $derived(
    roster.rows.map((r) => {
      // Enrich the row for its desktop notification: the TITLE reads
      // "<Project Name>: <Agent Title>". The Agent Title is the GENERATED session
      // title (the label on its card) when we have one, falling back to the
      // workspace/cwd `name` — so it reads "Fix login dialog" rather than the bare
      // "Session N". The Project Name is the agent's owning project's display name
      // (dropped when it has none). `notificationTitle`/`Body` read `name`/
      // `projectName`; the focus logic keys on `paneId`, so both overrides are
      // alert-display only.
      const title = titles.titleFor(r.paneId);
      const proj = projectForId(projects.list, r.projectId);
      const projectName = proj ? projectLabel(proj) : null;
      return { ...r, name: title ?? r.name, projectName };
    })
  );
  // The agent the user is "viewing": the focused grid PANE in grid view (focusedPaneId,
  // not the leaf id), else the inbox focus agent — used by the `agent-unfocused` mode.
  const viewedPaneId = $derived(view.isGrid ? workspace.focusedPaneId : focusAgent.paneId);
  // Alerts stay PRIMED (baseline tracked, nothing fired) until the app has SETTLED:
  // the layout has restored, prefs have loaded, and a short grace has elapsed. The
  // grace is load-bearing — the roster fills in asynchronously after `restored` (panes
  // re-spawn, snapshots/events seed), and a resumed session that re-derives its quiet
  // "waiting" prompt during that window must count as a pre-existing waiter, NOT a new
  // entry. Priming each tick keeps the baseline current so those waiters never alert.
  const ALERT_SETTLE_MS = 6000;
  let alertReadyAtMs: number | null = null;
  $effect(() => {
    if (restored && notifications.loaded && alertReadyAtMs === null) {
      alertReadyAtMs = alertNowMs;
    }
    const settled =
      restored &&
      notifications.loaded &&
      alertReadyAtMs !== null &&
      alertNowMs - alertReadyAtMs >= ALERT_SETTLE_MS;
    if (!settled) {
      alerts.prime(alertRows); // track the baseline; fire nothing while still settling
      return;
    }
    alerts.process(alertRows, { appFocused: windowFocus.focused, viewedPaneId });
  });

  // KEEP-AWAKE driver (capability `keep-awake`). Resolves the preference plus the same
  // always-mounted roster the alerts use (so grid and overview views agree) into one
  // "hold the sleep inhibitor" boolean, and asks the backend to acquire/release ONLY on
  // a transition (never once per tick). Teardown releases whatever is held; the Rust
  // close handler and the platform semantics (`caffeinate -w <pid>`, a thread-owned
  // Windows execution state) are the further safety nets, so the inhibitor can never
  // outlive the app.
  const keepAwakeDriver = new KeepAwakeDriver((enabled) => {
    void invoke('keep_awake_set', { enabled }).catch(() => {
      /* best-effort: a missing backend (vite dev) or a failed spawn is not a UI error */
    });
  });
  $effect(() => {
    keepAwakeDriver.update(shouldKeepAwake(keepAwake.mode, alertRows.some(isWorking)));
  });
  $effect(() => () => keepAwakeDriver.release());

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
      focusedId: workspace.focusedPaneId ?? '', // the PANE id (registry key), not the leaf id
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
  // Terminals placement (tasks-panel / ui-preferences): in the COMBINED placement
  // terminals are rows in the sessions list, the right dock + its toggle are hidden
  // (the dock stays mounted, hidden, as the PTY home), ⌘J is inert, and a new
  // terminal is SELECTED as a row (via `focusRequest`) rather than focused in the dock.
  const combinedTerminals = $derived(terminalsCombined(uiPrefs.data.terminalsPlacement));
  const dockShown = $derived(showTerminalsDock(uiPrefs.data.terminalsPlacement, tasksPanel.open));

  function newTerminal() {
    tasksPanel.open = true;
    const pid = terminalsActiveProjectId;
    if (!pid) return;
    const id = projectTasks.launchBareTerminal(pid);
    const pane = projectTasks.bareForProject(pid).find((b) => b.id === id)?.paneId;
    if (pane) {
      lastCycledPaneId = pane;
      if (combinedTerminals) {
        focusRequest.request(pane); // the inbox selects the new terminal row
      }
      focusTerminal(pane); // registry parks the request until the pane mounts
    }
  }

  // Cmd-Tab focus cycle: the focused agent, then the active project's running
  // terminals in order. `lastCycledPaneId` tracks our position so repeated presses
  // walk the ring (falling back to the focused agent when the ring shifts).
  let lastCycledPaneId: string | null = null;
  function focusCycleList(): string[] {
    const list: string[] = [];
    // The focused agent by PANE id (what focusTerminal / the roster key on) — the
    // tree leaf id (`workspace.focusedId`) is not a terminal handle.
    const agent = workspace.focusedPaneId;
    if (agent) list.push(agent);
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
      : (workspace.focusedPaneId ?? '');
    const cur = list.indexOf(anchor);
    const next = list[(cur + 1 + list.length) % list.length];
    lastCycledPaneId = next;
    // Combined placement: a terminal is visible only as the SELECTED row, so cycling
    // onto one selects its row (the inbox then focuses + scrolls it); cycling back
    // onto the agent selects the agent row the same way.
    if (combinedTerminals) {
      focusRequest.request(next);
      return;
    }
    focusTerminal(next);
    scrollTerminalToBottom(next);
  }

  // Keyboard shortcuts. The app-level bindings are USER-CUSTOMIZABLE (Settings →
  // Keyboard shortcuts): each check below asks the `shortcuts` store whether the
  // keydown is that action's CURRENT chord (default in parentheses), so a rebound
  // shortcut fires on its new chord and never on the old one.
  //   newSession (⌘N)          open the session LAUNCHER / launch into the project
  //   newWorktreeSession (⌘⇧N) open the launcher with the worktree option preset
  //   createTask (⌘T)          open the create-task dialog for the active project
  //   toggleTerminals (⌘J)     toggle the right-docked Terminals panel
  //   newTerminal (⌘Y)         open a new bare interactive terminal
  //   cycleFocus (⌘Tab)        cycle focus across the active agent + its terminals
  //   showShortcuts (⌘/)       toggle the help modal
  //   insertFilePath (⌘O)      insert a picked file's path into the focused terminal
  // Fixed (not rebindable): Esc, bare `?`. Grid-only (inert): ⌘W / ⌘] / ⌘[ / ⌥-Arrow.
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

    // What's new modal (release notes): like confirm/help, it owns the keyboard
    // while open — Esc closes it (covered here so it works with focus anywhere)
    // and every shortcut beneath is blocked. It reopens from Settings, so it can
    // sit over the Settings dialog; on close, hand focus back to that dialog so
    // its own Esc handler keeps working (it only fires with focus inside it).
    if (whatsNew.open) {
      if (key === 'Escape') {
        e.preventDefault();
        whatsNew.close();
      }
      return;
    }

    // Help overlay: Cmd-/ toggles it from anywhere; bare ? opens it too, but only
    // when NOT typing into a field/terminal, so a literal "?" still reaches prompts
    // and the xterm terminal (Cmd-/ is the always-safe path). Handled before the
    // per-view guards so help works in every view; `help.open` below then blocks the
    // pane shortcuts beneath the modal (the modal owns its own Esc).
    if (shortcuts.matches(e, 'showShortcuts')) {
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
    if (shortcuts.matches(e, 'newSession')) {
      e.preventDefault();
      startNewSession();
      return;
    }

    // newWorktreeSession (⌘⇧N) opens the launcher with "Start in a new git
    // worktree" preset (+ the filtered project preselected) so a name can be typed.
    if (shortcuts.matches(e, 'newWorktreeSession')) {
      e.preventDefault();
      startNewWorktreeSession();
      return;
    }

    // Cmd-J toggles the right-docked Terminals panel (process-independent: hiding
    // never kills a running terminal). Works in every view, like Cmd-N.
    if (shortcuts.matches(e, 'toggleTerminals')) {
      e.preventDefault();
      if (!combinedTerminals) tasksPanel.toggle(); // inert when terminals are rows
      return;
    }

    // Cmd-T opens the create-task dialog for the active project (every view).
    if (shortcuts.matches(e, 'createTask')) {
      e.preventDefault();
      taskDialog.showCreate(terminalsActiveProjectId);
      return;
    }

    // Cmd-Y opens a new bare interactive terminal in the Terminals panel.
    if (shortcuts.matches(e, 'newTerminal')) {
      e.preventDefault();
      newTerminal();
      return;
    }

    // Cmd-Tab cycles focus across the active agent and its project's terminals.
    // NOTE: macOS reserves Cmd-Tab for the app switcher at the system level, so this
    // may not reach the webview on macOS; it works where the OS lets the key through.
    if (shortcuts.matches(e, 'cycleFocus')) {
      e.preventDefault();
      cycleFocus();
      return;
    }

    // insertFilePath (⌘O) inserts a picked file's quoted path into the FOCUSED
    // terminal at the cursor. A global shortcut (works in every view, incl. while
    // xterm holds focus) — placed BEFORE the grid-only gate below so it isn't made
    // inert. The chord match is EXACT (a stray ⌘⌥O / ⌘⌃O falls through).
    // `insertFilenameInto` checks the focused handle BEFORE opening the picker, so
    // this is a clean no-op (no dialog) when no terminal is focused; preventDefault
    // keeps the keystroke off the PTY and suppresses the webview's native "Open
    // file" accelerator.
    if (shortcuts.matches(e, 'insertFilePath')) {
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
      <!-- During the first-launch onboarding gate keep the titlebar (logo + drag
           region) but hide these controls — they act on a workspace that isn't set
           up yet. The empty cell still balances the centered title and stays a drag
           region, so the window remains movable while the gate is up. -->
      {#if !onboarding.visible}
      <!-- Opt back into pointer events (the bar is a drag region) so the buttons are
           clickable. Gear opens Settings; "?" opens the shortcuts modal (⌘/ and ?). -->
      <!-- Update pill (desktop-auto-update spec): leftmost of the right-side
           controls, shown for any non-idle update state and morphing in place —
           downloading (progress) → ready (gift, click to install+relaunch) →
           installing; or failed (click to retry). Hidden when idle. -->
      {#if updateStore.status !== 'idle'}
        {@const st = updateStore.status}
        {@const busy = st === 'downloading' || st === 'installing'}
        <button
          class="update-pill"
          class:is-failed={st === 'failed'}
          class:is-busy={busy}
          disabled={busy}
          aria-label={st === 'ready'
            ? 'Restart to update'
            : st === 'failed'
              ? 'Update failed, click to retry'
              : st === 'installing'
                ? 'Restarting to update'
                : 'Downloading update'}
          use:tooltip={{
            text:
              st === 'ready'
                ? `Agent Desktop ${updateStore.version} is ready`
                : st === 'failed'
                  ? 'Update failed — click to retry'
                  : st === 'installing'
                    ? 'Restarting…'
                    : updateStore.percent === null
                      ? `Downloading Agent Desktop ${updateStore.version}…`
                      : `Downloading Agent Desktop ${updateStore.version}… ${updateStore.percent}%`,
            placement: 'bottom'
          }}
          onclick={() => {
            if (updateStore.status === 'ready') void updateStore.restartToUpdate();
            else if (updateStore.status === 'failed') void updateStore.retry();
          }}
        >
          <Icon
            name={st === 'ready' ? 'gift' : st === 'failed' ? 'triangle-alert' : 'rotate-ccw'}
            size={13}
          />
          <span>
            {#if st === 'ready'}
              Restart to update
            {:else if st === 'failed'}
              Update failed · retry
            {:else if st === 'installing'}
              Restarting…
            {:else if updateStore.percent === null}
              Updating…
            {:else}
              Updating… {updateStore.percent}%
            {/if}
          </span>
        </button>
      {/if}
      {#if !combinedTerminals}
      <button
        class="tb-btn"
        class:active={tasksPanel.open}
        aria-label="Toggle terminals panel"
        aria-pressed={tasksPanel.open}
        use:tooltip={{ text: `Terminals (${shortcuts.text('toggleTerminals')})`, placement: 'bottom' }}
        onclick={() => tasksPanel.toggle()}
      >
        <Icon name="panel-right" size={14} />
        {#if projectTasks.runningCount > 0}
          <span class="tb-badge" aria-label={`${projectTasks.runningCount} running`}>
            {projectTasks.runningCount}
          </span>
        {/if}
      </button>
      {/if}
      <button class="tb-btn" aria-label="Settings" use:tooltip={{ text: 'Settings', placement: 'bottom' }} onclick={() => settingsModal.show()}>
        <Icon name="settings" size={14} />
      </button>
      <button class="help-btn" aria-label="Keyboard shortcuts" use:tooltip={{ text: `Keyboard shortcuts (${shortcuts.text('showShortcuts')})`, placement: 'bottom' }} onclick={() => help.show()}>?</button>
      {/if}
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
    class:hidden={!dockShown}
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
<!-- Release notes modal. Held back while the first-launch model gate is up (the
     store keeps `open` set, so it appears as soon as the gate is dismissed). -->
{#if !onboarding.visible}
  <WhatsNewModal />
{/if}
<!-- Voice input (the bottom-center mic FAB + the dictation panel) sits above the
     onboarding gate's z-index, so hide it entirely while the first-launch gate is
     up: the models it needs aren't downloaded yet and the takeover owns the screen. -->
{#if !onboarding.visible}
  <VoicePanel />
{/if}
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
    height: var(--titlebar-h);
    flex: 0 0 var(--titlebar-h);
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

  /* "Restart to update" pill (desktop-auto-update spec). Solid-orange call to
     action that sits leftmost in the right cluster only when an update is staged.
     Dark text/icon for contrast on orange (mirrors the green count badge). */
  .update-pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 10px;
    border: 1px solid var(--orange-600);
    border-radius: var(--r-full);
    background: var(--orange-500);
    color: #1a0d06;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    /* The title bar is a drag region (pointer-events suppressed on children);
       re-enable so the pill is hoverable/clickable. */
    pointer-events: auto;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast),
      box-shadow var(--dur-fast);
  }
  .update-pill:not(:disabled):hover {
    background: var(--orange-400);
    border-color: var(--orange-500);
    box-shadow: var(--glow-orange);
  }
  /* Downloading / installing: inert (no click), with the icon spinning to signal
     work in progress. Full opacity — it's status, not a disabled control. */
  .update-pill.is-busy {
    cursor: default;
  }
  .update-pill.is-busy :global(.mc-icon) {
    animation: update-pill-spin 0.9s linear infinite;
  }
  @keyframes update-pill-spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Failed download: danger-tinted, clickable to retry. */
  .update-pill.is-failed {
    background: var(--danger, #e5484d);
    border-color: var(--danger, #e5484d);
    color: #fff;
  }
  .update-pill.is-failed:hover {
    background: #d93d42;
    border-color: #d93d42;
    box-shadow: none;
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
