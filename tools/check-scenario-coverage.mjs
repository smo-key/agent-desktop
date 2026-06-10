#!/usr/bin/env node
// Scenario-coverage gate (tasks.md 1.5).
//
// Parses every `#### Scenario:` heading under
//   openspec/changes/*/specs/**/*.md   (and openspec/specs/** once archived),
// normalizes each scenario title to snake_case, then scans the test corpus for a
// matching test name:
//   - Rust:   `fn <snake>(` in src-tauri/**/*.rs
//   - Vitest: it('<title>'…) / test('<title>'…) / describe('<title>'…) in src/**/*.{test,spec}.{ts,js}
// A scenario is COVERED iff its snake_case name appears as a Rust test fn or as a
// (snake-normalized) Vitest title.
//
// Milestone scoping: this gate ENFORCES exactly the capabilities listed in
// ENFORCED_CAPABILITIES (Milestone 1 => only `terminal-core`). Every other
// capability's scenarios are printed as KNOWN-PENDING (future milestones) and do
// NOT affect the exit code.
//
// Headless-exempt scenarios: a small allowlist of scenarios are inherently
// GPU/DOM/live-TUI bound and cannot be exercised by a headless automated test
// (no real WebGL context, no live xterm+PTY wiring, no window resize in CI).
// These are reported as MANUAL (needs live in-app confirmation) and do NOT fail
// the gate — but they are NEVER silently treated as passing automated coverage.
// They are listed explicitly so the human knows exactly what to confirm live.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// --- Milestone configuration -------------------------------------------------

// Milestone 1 enforces terminal-core. Milestone 2 adds tiling-layout and
// layout-persistence (all their pure-logic scenarios are now unit-tested).
// Milestone 3 adds usage-dashboard (wrapper snapshot write, per-session settings
// override, snapshot-store reducer, account rollup math — all pure/headless and
// unit-tested; the genuinely-live aspects are listed in MANUAL_SCENARIOS below).
// Milestone 4 adds task-detection: the live-tasks-dir derivation, the schema
// fallback, the context-bridge parse, the exclude-app-sessions filter, and the
// live/idle heartbeat are all pure/headless and unit-tested (Rust task.rs +
// frontend task.test.ts); the only headless-exempt scenario is the rendered
// per-pane badge/card (MANUAL below).
// Milestone 5 adds session-launcher: the launch-plan builder (program is always
// claude, placement tab/split + split->tab fallback), the recent-folders model
// (add/dedupe/cap/parse/serialize round-trip), and the optional initial-input
// delivery (verbatim + single \r, sent-once, never a synthesized slash command)
// are all pure/headless and unit-tested (plan.test.ts / recents.test.ts /
// initialInput.test.ts). The genuinely-live aspects — the native folder dialog,
// the DOM-rendered recents picker, and the actual spawn-in-folder (statusline
// override + pane env + global-settings-untouched) — are listed in
// MANUAL_SCENARIOS below.
// Milestone 10 adds agent-overview: the roster view-model (one row per app pane,
// status from heartbeat+activity), per-agent + aggregate usage, the message-an-
// agent dispatch (verbatim text + single \r, never a synthesized command), the
// navigate-target resolver (paneId -> {workspaceId, leafId}), the top-level view
// toggle (overview <-> grid), and the Rust subagent reader (subagents under their
// parent; partial metadata tolerated) — all pure/headless and unit-tested
// (src/lib/overview/*.test.ts + src-tauri/src/subagents.rs tests). The single
// MANUAL aspect is the end-to-end new-agent launch (the live launcher dialog +
// spawn-in-folder + the new pane appearing as a roster row), which needs a real
// window + PTY (listed in MANUAL_SCENARIOS below).
const ENFORCED_CAPABILITIES = new Set([
  'terminal-core',
  'tiling-layout',
  'layout-persistence',
  'usage-dashboard',
  'task-detection',
  'session-launcher',
  'agent-overview',
  // projects: a project = a working folder with a name/color/icon, bound to an
  // agent EXPLICITLY at launch (registry projectId, persisted). Every scenario is
  // pure/headless and unit-tested — plan.test.ts (Project assigned at launch),
  // roster.test.ts (Agent carries its project identity), projects.test.ts (Creating
  // a project … deduped by folder), projectRollup.test.ts (Filter agents by
  // project). The DOM-rendered project panel/avatars are confirmed live.
  'projects',
  // activity-events: the hook → Unix socket → durable sink pipeline. Every scenario
  // has a REAL headless test — event-hook.test.ts (full set registration is in
  // spawn.test.ts; summarize / pending-question / one-line delivery / socket-absent
  // no-block) and src-tauri/src/events.rs (accept+buffer / malformed-drop / stale
  // socket rebind / sink append + sessionId keying / age+size retention / resume
  // reads the sink / transcript backfill). No MANUAL: the live socket end-to-end is
  // exercised headlessly by the Rust accept test.
  'activity-events',
  // activity-timeline: event-sourced status + currentAction + per-tool timeline.
  // Every scenario except the two live route-interval behaviors is unit-tested —
  // events.test.ts (status mapping / current action / question lifecycle / fallback
  // / timeline accumulation), events.svelte.test.ts (ingest + seed-on-mount +
  // pending-question), roster.test.ts (exit-authoritative / status-independent-of-
  // snapshot / cost-model-from-snapshot), poll.test.ts (content-refreshed-on-stop).
  // The two MANUAL scenarios are the route's setInterval wiring (see below).
  'activity-timeline',
  // project-terminals: the per-project terminal model (create/rename/remove,
  // default-name derivation, per-project keying), the persisted-vs-runtime split,
  // selective auto-restart (only wasRunning terminals), and the runtime lifecycle
  // (start/stop/restart, process-exit → stopped) are all unit-tested —
  // projectTerminals.test.ts (pure model) + projectTerminals.svelte.test.ts (store
  // lifecycle, invoke mocked). The single MANUAL scenario is the OS-level reap on
  // app quit (same kill_all path terminal-core already tests; see MANUAL below).
  'project-terminals',
  // terminals-panel: the project-scoping resolver (follow-focus → activeProjectId,
  // swap-on-focus, no-project empty state), the toggle store, and the running-count
  // indicator math are unit-tested — activeProject.test.ts + panel.svelte.test.ts +
  // projectTerminals.svelte.test.ts. The genuinely live-DOM/live-PTY scenarios (CSS
  // reflow, drag-resize, interactive terminal, process-survives-hide/switch,
  // re-attach) are MANUAL below.
  'terminals-panel',
  // project-tasks: evolved from project-terminals — the task model (kind
  // terminal|agent, command/prompt, per-project keying, default-name derivation,
  // runtime-vs-persisted split), persistence + one-time legacy terminals.json
  // migration, lifecycle (start/stop/restart), completion semantics (success
  // auto-close / error keep+failed / dismiss / long-runner persists), agent
  // dispatch (opens a workspace session, no right-panel pane), and transient bare
  // terminals are ALL pure/headless and unit-tested (projectTasks.test.ts +
  // projectTasks.svelte.test.ts). No MANUAL scenarios.
  'project-tasks',
  // tasks-panel: the two panel SURFACES — the left Tasks launcher under the Agents
  // roster (list, splitter, create form, footer actions) and the renamed right-
  // docked Tasks dock (running task + bare-terminal panes, no `+`) — are genuinely
  // live-DOM / live-PTY bound (rendered components, drag-resize, interactive xterm,
  // process-survives-hide/switch, ⌘T/⌘J shortcuts against the live registry). Every
  // scenario is headless-exempt (MANUAL below), like terminals-panel's rendered
  // behaviors; the pure scoping resolver they reuse is covered under activeProject.
  'tasks-panel',
  // project-folder-storage: per-project `.agent-desktop/{tasks,config}.json` storage
  // (relocated off the user-level app-data dir). The directory/file layout, path-keyed
  // load/save, missing-file tolerance, and atomic write are Rust-tested
  // (project_store.rs); the sanitized serialization, config defaults, per-project
  // envelope, no-auto-restart, resilience (in-memory + retry), and the one-time
  // destructive migration are pure/headless and unit-tested (projectTasks.test.ts,
  // projectTasks.svelte.test.ts, migrateProjectFolders.test.ts, projects.test.ts).
  // The single headless-exempt scenario is "Not gitignored" (asserting the absence of
  // a real on-disk `.gitignore` mutation in the live app) — MANUAL below.
  'project-folder-storage',
  // git-branch-switching: the footer branch pill opens a picker that switches local
  // branches, checks out remote-tracking branches (as local tracking branches via
  // git DWIM), and creates branches off HEAD. The branch QUERY (current + local +
  // remotes, bare-remote-HEAD excluded) is Rust-tested (git.rs:
  // branches_are_listed_with_the_current_branch_marked / repository_with_no_remote /
  // detached_head), and the switch/create/remote/guard/filter actions are pure and
  // unit-tested (branchActions.test.ts). The three genuinely DOM-bound scenarios —
  // the rendered footer pill being actionable, the project-pane pill staying read-
  // only, and the no-branch pill not opening — are MANUAL below.
  'git-branch-switching',
]);

// Scenarios that cannot be tested headless (GPU / DOM / live TUI). Keyed by
// capability -> set of snake_case scenario names. Reported as MANUAL, not failed.
const MANUAL_SCENARIOS = {
  'terminal-core': new Set([
    'webgl_loaded_for_a_visible_pane',
    'context_loss_falls_back_to_dom',
    'webgl_restricted_to_stay_under_the_context_ceiling',
    'reparenting_does_not_remount_the_terminal',
    'ordered_teardown_leaves_no_leaks',
  ]),
  // tiling-layout: every split/close/resize-math/focus/paneId-stability scenario
  // is a pure-tree unit test (enforced). What remains is genuinely live-DOM bound:
  // an actual workspace switch in the rendered tree, the runtime guarantee that a
  // live xterm is not remounted, and the mid-drag (real pointer gesture) variant
  // of that same no-remount guarantee. These need a real window + live xterm/PTY.
  'tiling-layout': new Set([
    'switch_to_another_workspace_via_the_rail',
    'switching_workspaces_does_not_remount_terminals',
    'resize_does_not_remount_terminals_mid_drag',
    // Pane context menu: the action-dispatch + disabled-state scenarios are pure
    // unit tests (enforced via paneMenu.test.ts); these two are gesture/DOM bound.
    'right_click_opens_the_menu_at_the_cursor_and_focuses_the_pane',
    'menu_dismisses_on_escape_outside_click_or_after_an_action',
  ]),
  // layout-persistence: serialize/validate/migrate/respawn/fallback/debounce are
  // all enforced unit tests. Only the OPTIONAL addon-serialize scrollback repaint
  // (requires a live xterm buffer) is headless-exempt.
  'layout-persistence': new Set([
    'scrollback_repainted_before_reattach',
    'missing_scrollback_does_not_block_restore',
  ]),
  // usage-dashboard: every scenario has a REAL headless automated test, so the
  // MANUAL set is intentionally empty (this gate's MANUAL category means "no
  // automated coverage", which is false for all 18 here):
  //   - wrapper snapshot write / atomic tmp+rename / pane-id key / field shape /
  //     context-from-correct-fields / absent-rate-limits / missing-statusline /
  //     snapshot-side-effect — statusline-wrapper.test.ts (runs the real wrapper).
  //   - per-session settings override leaves global untouched — spawn.test.ts.
  //   - snapshot-store reducer (change pushed / malformed skipped) —
  //     snapshots.test.ts (+ Rust read_snapshot / malformed_snapshot_skipped /
  //     watcher_emits_parsed_snapshot_on_write integration tests).
  //   - account rollup math + graceful missing rate-limits/context — rollup.test.ts.
  // Three aspects still warrant a LIVE in-app confirmation (documented in the
  // stage report, NOT failed/marked MANUAL since each has real headless coverage
  // of a load-bearing property): the wrapper delegating to the user's real
  // ~/.claude/hooks/statusline.js so the in-pane bar is byte-for-byte identical
  // (the headless test asserts only "delegation never crashes + snapshot still
  // written"); the notify watcher firing end-to-end against a live claude pane;
  // and the rendered two-row dashboard visual itself.
  'usage-dashboard': new Set(),
  // task-detection: every derivation/parse/filter/heartbeat scenario has a REAL
  // headless test (Rust task.rs: newest_in_progress_entry_wins /
  // no_in_progress_entry_yields_null_task / activeform_present /
  // activeform_missing_subject_present / unknown_extra_fields_do_not_break_parsing
  // / foreign_session_task_surfaced / context_bridge_fallback /
  // missing_todos_directory_is_not_required / fresh_ts_is_live / stale_ts_is_idle;
  // frontend task.test.ts: task_read_from_snapshot / null_task_in_snapshot /
  // task_updates_on_snapshot_change). The single MANUAL aspect is the genuinely
  // DOM-bound rendering of the task badge on the pane AND the same activeForm on
  // the dashboard card — there is no rendered component in this stage to assert
  // against, so it needs a live in-app confirmation.
  'task-detection': new Set(['badge_and_card_reflect_current_task']),
  // session-launcher: every PURE scenario has a REAL headless test under exactly
  // ONE title each —
  //   - plan.test.ts: open_the_session_in_a_new_tab /
  //     open_the_session_by_splitting_the_focused_pane /
  //     split_placement_is_unavailable_with_no_focused_pane (the slash-command
  //     guarantees are owned by initialInput.test.ts; the plan-level variants use
  //     distinct titles so each scenario maps to exactly one covering test).
  //   - recents.test.ts: a_launched_folder_is_added_to_recents /
  //     recents_survive_an_app_restart /
  //     re_launching_an_existing_folder_does_not_duplicate_it.
  //   - initialInput.test.ts: launch_with_an_initial_prompt /
  //     launch_with_no_initial_prompt / no_slash_command_is_injected_on_launch /
  //     initial_prompt_beginning_with_a_slash_is_passed_through_verbatim.
  // The MANUAL set is exactly the genuinely-live aspects:
  //   - the native Tauri folder dialog opening + the absolute path becoming cwd,
  //     and its Cancel-aborts-the-launch variant (no headless dialog);
  //   - the DOM-rendered recents list whose one-click entry sets cwd (no rendered
  //     component to assert against headless; chooseRecent itself is trivial);
  //   - the actual spawn-in-folder carrying the --settings statusline override +
  //     AGENT_DESKTOP_PANE/AGENT_DESKTOP_SNAPSHOT_DIR env, and leaving the user's
  //     global ~/.claude/settings.json byte-identical. NOTE: the launcher REUSES
  //     (does not duplicate) the usage-dashboard spawn path, whose load-bearing
  //     properties already have headless coverage there (spawn.test.ts:
  //     "Global config left byte-identical" / "Pane id passed into the spawned
  //     process env"); what is MANUAL here is the end-to-end launcher-driven
  //     spawn in the chosen cwd, which needs a real PTY + window.
  'session-launcher': new Set([
    'open_the_launcher_and_pick_a_folder_via_the_native_picker',
    'cancelling_the_folder_picker_aborts_the_launch',
    'select_a_folder_from_the_recent_folders_list',
    'spawn_carries_the_statusline_override_and_pane_env',
    'global_settings_are_not_mutated',
  ]),
  // agent-overview: every PURE scenario has a REAL headless test under exactly one
  // title each —
  //   - roster.test.ts: roster_reflects_running_agents /
  //     agent_status_reflects_working_waiting_finished_and_errored.
  //   - usage.test.ts: per_agent_usage_reflects_the_snapshot /
  //     aggregate_usage_sums_agents_and_subagents.
  //   - message.test.ts: sending_a_message_writes_to_the_agent_pty /
  //     only_user_entered_text_is_ever_sent.
  //   - navigate.test.ts: selecting_an_agent_focuses_its_pane (the PURE target
  //     resolution paneId -> {workspaceId, leafId}; the live store mutation + view
  //     switch is the MANUAL part of the same flow, confirmed in-app).
  //   - view.svelte.test.ts: switch_between_the_overview_and_grid_views.
  //   - subagents.rs (Rust): subagents_appear_under_their_parent_agent /
  //     partial_subagent_metadata_does_not_break_the_roster.
  // The MANUAL set covers the three live-only inbox behaviors:
  //   - end-to-end new-agent launch: the live launcher dialog + spawn-in-folder +
  //     the freshly-created pane appearing as a roster row (real window + PTY).
  //   - terminal focus + scroll-to-bottom on entry to an agent: requires a live
  //     xterm instance; pure selection logic is unit-tested in inbox.test.ts.
  //   - the live surface teleported into the focus pane without respawning: the
  //     surfaceSlot portal wiring requires a real DOM + mounted PTY to confirm.
  //   - leaving a previewing (resumed-from-Archived) session re-archives it after a
  //     60s grace: a $effect-driven setTimeout keyed on the shown agent + live PTY
  //     teardown, with no pure surface to assert (the registry transitions it drives —
  //     previewArchived/commitPreview/closeAgent — are unit-tested in
  //     workspace.svelte.test.ts; the grace-timer wiring is confirmed in-app).
  'agent-overview': new Set([
    'new_agent_action_launches_and_rosters',
    'entering_an_agent_focuses_its_terminal_and_scrolls_to_the_bottom',
    'the_live_surface_is_teleported_into_the_focus_pane_without_respawning',
    'leaving_a_previewing_session_re_archives_it_after_the_grace_period',
  ]),
  // projects: the footer-git resolver (which project's folder git the footer's
  // left zone shows: focused pane → panel selection → none) is unit-tested in
  // footerView.test.ts. The one headless-exempt scenario is the rendered project
  // row NO LONGER carrying a git line — a DOM-render assertion with no
  // component-render harness in this repo, confirmed live like the other
  // DOM-rendered project-panel behaviors.
  projects: new Set(['project_rows_carry_no_git_line']),
  // activity-events: the live socket end-to-end is covered headlessly by the Rust
  // accept test, so nothing is MANUAL here.
  'activity-events': new Set(),
  // activity-timeline: the two genuinely-live aspects are the route's own
  // setInterval wiring — the slow safety-poll backstop, and the ABSENCE of the
  // retired 1.5s fast poll. Both are $effect intervals in +page.svelte with no
  // pure surface to assert against (the read POLICY itself is unit-tested as
  // "Content refreshed on stop"); they are confirmed live in-app.
  'activity-timeline': new Set(['safety_poll_backstops_missed_events', 'fixed_fast_poll_removed']),
  // project-terminals: every model + store-lifecycle scenario is unit-tested. The
  // one MANUAL is the OS-level reap of all terminal processes on app quit — it runs
  // through the SAME `manager.kill_all()` on CloseRequested that terminal-core
  // already exercises, but is confirmed live for this panel's PTYs.
  'project-terminals': new Set(['all_terminal_processes_reaped_on_quit']),
  // terminals-panel: the project-scoping resolver, toggle store, and running-count
  // math are unit-tested. What remains is genuinely live-DOM / live-PTY: the CSS
  // reflow on toggle, the no-mutation-of-the-workspace-tree guarantee, the drag
  // resize, an interactive terminal, and the process-survives-hide / -switch /
  // re-attach guarantees (all require a real window + live xterm/PTY).
  'terminals-panel': new Set([
    'toggle_the_panel_off_reclaims_space',
    'panel_state_is_independent_of_the_workspace_tree',
    'swapping_the_collection_does_not_change_any_process_state',
    'multiple_terminals_visible_at_once',
    'resizing_a_terminals_share',
    'terminal_is_interactive',
    'hiding_the_panel_keeps_a_server_running',
    're_showing_the_panel_re_attaches_to_live_processes',
    'switching_projects_keeps_the_other_projects_processes_alive',
    // Keyboard shortcuts: the ⌘T create path and ⌘Tab focus ring are wired in
    // +page.svelte's keydown handler against the live registry/PTYs — confirmed live
    // (and ⌘Tab is additionally subject to the macOS app-switcher reservation).
    'new_terminal_shortcut_opens_an_empty_shell',
    'focus_cycle_shortcut_moves_between_agent_and_terminals',
  ]),
  // project-tasks: every scenario has a REAL headless test (model + store), so the
  // MANUAL set is intentionally empty.
  'project-tasks': new Set(),
  // projects: the context-menu Push/Pull actions + their success/terminal-on-
  // failure/toast-fallback/no-folder behaviors are pure-logic unit tests
  // (projectGitActions.test.ts). Two scenarios are genuinely DOM-bound (rendered
  // project pane / footer) with no pure surface to assert headless, confirmed live:
  //   - the FOOTER surface wiring the rendered ahead/behind git pills to the same
  //     (tested) pushProject/pullProject actions;
  //   - the project rows rendering with NO git status line (git moved to the footer).
  'projects': new Set([
    'push_and_pull_are_available_from_the_footer',
    'project_rows_carry_no_git_line',
  ]),
  // tasks-panel: every scenario is a rendered-component / live-PTY behavior with no
  // pure surface to assert headless — confirmed live in-app.
  'tasks-panel': new Set([
    'panel_position_and_default_size',
    'resizable_splitter',
    'active_project_scoping',
    'empty_and_no_project_states',
    'header_matches_the_agents_bar',
    'create_a_task_via_the_dialog',
    'clicking_a_task_starts_it',
    'edit_or_delete_via_context_menu',
    'edit_a_task_via_the_dialog',
    'delete_requires_confirmation',
    'start_and_stop_from_the_list',
    'status_reflects_failure',
    'dialog_mimics_the_new_session_modal',
    'name_is_optional',
    'command_field_is_monospace',
    'titled_terminals_with_a_new_terminal_button',
    'hosts_terminal_task_runs',
    'toggle_and_badge_preserved',
    'processes_survive_hide_and_project_switch',
    'cmd_t_opens_the_task_dialog',
    'keyboard_shortcut_opens_a_bare_terminal',
    'new_terminal_button',
    'completion_toast_on_success',
  ]),
  // git-branch-switching: every data/action scenario is headlessly tested (Rust
  // list_branches + branchActions.test.ts). The three rendered-pill behaviors have
  // no pure surface to assert — the footer pill being an actionable button, the
  // project-pane pill staying a read-only span, and the no-branch/no-repo pill not
  // opening a picker — so they are confirmed live in-app.
  'git-branch-switching': new Set([
    'footer_pill_is_actionable',
    'non_footer_pill_stays_read_only',
    'no_branch_to_switch',
  ]),
};

// --- helpers -----------------------------------------------------------------

function snake(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[''`"]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function walk(dir, filterRe, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'target' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, filterRe, acc);
    else if (filterRe.test(name)) acc.push(full);
  }
  return acc;
}

// --- 1. collect scenarios, grouped by capability ----------------------------

const specGlobs = [
  join(REPO_ROOT, 'openspec', 'changes'),
  join(REPO_ROOT, 'openspec', 'specs'), // present once archived
];

const scenariosByCap = new Map(); // capability -> [{ title, snake }]

for (const base of specGlobs) {
  for (const file of walk(base, /\.md$/)) {
    // capability = the directory name immediately under .../specs/
    const m = file.replace(/\\/g, '/').match(/\/specs\/([^/]+)\//);
    if (!m) continue;
    const capability = m[1];
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const sm = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
      if (!sm) continue;
      const title = sm[1];
      const arr = scenariosByCap.get(capability) ?? [];
      arr.push({ title, snake: snake(title) });
      scenariosByCap.set(capability, arr);
    }
  }
}

// --- 2. collect test names ---------------------------------------------------

const rustTestNames = new Set();
for (const file of walk(join(REPO_ROOT, 'src-tauri'), /\.rs$/)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bfn\s+([a-z0-9_]+)\s*\(/g)) {
    rustTestNames.add(m[1]);
  }
}

// Vitest titles. `npm run test` (vitest run) discovers *.{test,spec}.* across the
// whole repo, so the wrapper test that exercises the real production wrapper lives
// next to it at src-tauri/resources/statusline-wrapper.test.ts (NOT under src/).
// We must scan both trees or that real automated coverage would be invisible here.
const vitestTitles = new Set();
const vitestRoots = [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'src-tauri', 'resources')];
for (const root of vitestRoots) {
  for (const file of walk(root, /\.(test|spec)\.(ts|js|mjs)$/)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:it|test|describe)\s*\(\s*(['"`])([^'"`]+)\1/g)) {
      vitestTitles.add(snake(m[2]));
    }
  }
}

function isCovered(snakeName) {
  return rustTestNames.has(snakeName) || vitestTitles.has(snakeName);
}

// --- 3. report ---------------------------------------------------------------

const caps = [...scenariosByCap.keys()].sort();
const enforced = caps.filter((c) => ENFORCED_CAPABILITIES.has(c));
const pending = caps.filter((c) => !ENFORCED_CAPABILITIES.has(c));

let hardFailures = 0;
const lines = [];
lines.push('Scenario coverage gate (tools/check-scenario-coverage.mjs)');
lines.push(`  scanned: ${rustTestNames.size} Rust fn names, ${vitestTitles.size} Vitest titles`);
lines.push('');

for (const cap of enforced) {
  lines.push(`ENFORCED capability: ${cap}`);
  const scenarios = scenariosByCap.get(cap);
  const manual = MANUAL_SCENARIOS[cap] ?? new Set();
  let covered = 0;
  let manualCount = 0;
  const missing = [];
  for (const s of scenarios) {
    if (isCovered(s.snake)) {
      covered++;
      lines.push(`  [PASS]   ${s.title}  (${s.snake})`);
    } else if (manual.has(s.snake)) {
      manualCount++;
      lines.push(`  [MANUAL] ${s.title}  -> needs live in-app confirmation`);
    } else {
      missing.push(s);
      lines.push(`  [FAIL]   ${s.title}  (${s.snake})  -> no matching test`);
    }
  }
  lines.push(
    `  => ${covered} covered, ${manualCount} manual (headless-exempt), ${missing.length} missing of ${scenarios.length} total`
  );
  lines.push('');
  hardFailures += missing.length;
}

if (pending.length) {
  lines.push('KNOWN-PENDING capabilities (future milestones — not enforced now):');
  for (const cap of pending) {
    const n = scenariosByCap.get(cap).length;
    lines.push(`  - ${cap}: ${n} scenarios (pending)`);
  }
  lines.push('');
}

if (hardFailures > 0) {
  lines.push(`RESULT: FAIL — ${hardFailures} enforced scenario(s) have no matching test.`);
  console.log(lines.join('\n'));
  process.exit(1);
} else {
  lines.push('RESULT: PASS — every enforced, testable scenario has a matching test.');
  console.log(lines.join('\n'));
  process.exit(0);
}
