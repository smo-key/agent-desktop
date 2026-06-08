// PURE helper: build the per-pane PTY spawn parameters so a `claude` pane is
// launched THROUGH the app-managed statusline wrapper, while every other
// program (the login shell) spawns completely unchanged.
//
// Kept framework-free (no Svelte/Tauri imports) so it is trivially unit-tested.
// `TerminalPane.svelte` calls `buildSpawnOverride(...)` right before `pty_spawn`
// to obtain the final `{ args, env }` it forwards to the backend.
//
// Why an inline `--settings` override (design D3 / usage-dashboard spec): it
// merges per-key over the user's `~/.claude/settings.json` for THIS session
// only — overriding just `statusLine.command` — and NEVER reads, writes, or
// relocates the global config. The wrapper then (a) delegates to the user's real
// `~/.claude/hooks/statusline.js` for an unchanged in-pane bar and (b) writes a
// per-pane snapshot the dashboard watches. The two env vars
// (`AGENT_DESKTOP_PANE`, `AGENT_DESKTOP_SNAPSHOT_DIR`) reach the
// `statusLine.command` (verified, appendix A.1) so the wrapper knows which
// snapshot file to write and where.

/** Absolute paths resolved once from the `usage_paths` Tauri command. */
export interface UsagePaths {
  /** Absolute path to the installed `statusline-wrapper.js`. */
  wrapperPath: string;
  /** Absolute path to the snapshots dir. */
  snapshotDir: string;
  /**
   * Absolute path to the installed `event-hook.js` — the single hook wired into
   * every app-launched session that feeds the overview's event pipeline.
   */
  eventHookPath: string;
  /**
   * Absolute path to the app-hosted Unix-domain socket the event hook delivers
   * to (passed to the spawned process as `AGENT_DESKTOP_SOCKET_PATH`).
   */
  socketPath: string;
}

/** Inputs for building a pane's spawn override. */
export interface SpawnOverrideInput {
  /** The program the pane will run (`claude` is the only one we wrap). */
  program: string;
  /** The pane's existing args (preserved verbatim after any injected ones). */
  args: string[];
  /** The stable frontend pane id; becomes `AGENT_DESKTOP_PANE` + the snapshot filename key. */
  paneId: string;
  /**
   * The APP-OWNED Claude session id for this pane (a uuid generated at launch).
   * Injected as `--session-id <id>` (fresh pane) or `--resume <id>` (restored
   * pane with resume:true) so the overview can locate THIS agent's exact
   * transcript (`~/.claude/projects/<cwd>/<id>.jsonl`) — matching by cwd alone is
   * ambiguous when several sessions share a folder. Absent for non-claude panes.
   */
  sessionId?: string;
  /**
   * When `true` AND `sessionId` is set: inject `--resume <sessionId>` so the
   * restored pane continues from its prior transcript instead of starting fresh.
   * Mutually exclusive with `--session-id` — only one flag is emitted.
   * Falsey (default) keeps the existing `--session-id <sessionId>` behaviour.
   */
  resume?: boolean;
  /**
   * Resolved usage paths, or `null` if they could not be fetched. When null we
   * still inject `--session-id` / `--resume` (so activity works) but skip the
   * statusline wrapper override — a missing wrapper must never break launching a
   * session.
   */
  usagePaths: UsagePaths | null;
}

/**
 * The spawn parameters forwarded to `pty_spawn`. `env` is the optional extra
 * environment merged (caller-wins) on top of the backend's seeded base. For a
 * shell pane (or `claude` with no resolved usage paths) `env` is `undefined`
 * and `args` is unchanged, so those panes spawn exactly as before.
 */
export interface SpawnOverride {
  args: string[];
  env?: Array<[string, string]>;
}

/** The settings key we override for the per-session statusline. */
const STATUS_LINE_TYPE = 'command';

/**
 * Shell-quote an executable path for use as a claude `statusLine`/hook `command`.
 * Claude runs these commands THROUGH A SHELL, which splits on whitespace — and the
 * app installs the wrapper + hook under `~/Library/Application Support/…` (a path
 * with a SPACE). Unquoted, the shell breaks the path at the space and the script
 * silently never runs (no snapshot, no question sidecar). Wrapping in double quotes
 * (escaping the chars special inside them) makes the spaced path survive.
 */
export function quoteCommand(path: string): string {
  return `"${path.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * Build the spawn args/env for a pane.
 *
 *  - `program === 'claude'` →
 *      args = ['--session-id', <id>?,
 *              '--settings', JSON.stringify({ remoteControlAtStartup: false,
 *                statusLine?: { type: 'command', command: <wrapperPath> } }),
 *              ...existingArgs]
 *      env  = [['AGENT_DESKTOP_PANE', paneId],
 *              ['AGENT_DESKTOP_SNAPSHOT_DIR', snapshotDir],
 *              ['AGENT_DESKTOP_SOCKET_PATH', socketPath]]  // only with usagePaths
 *  - anything else (shell panes) →
 *      args = existingArgs unchanged, env = undefined.
 *
 * The `--settings` override is ALWAYS injected for a claude pane (even with no
 * usage paths) because it carries `remoteControlAtStartup: false`. The user's
 * global `remoteControlAtStartup: true` otherwise hands the session to the cloud
 * Remote-Control bridge, which writes only a STUB local transcript (a
 * `bridge-session` marker, no assistant turns / `AskUserQuestion` / token usage) —
 * starving the overview's transcript-derived activity (last message, pending
 * question, context %). Disabling it per-session keeps the full transcript local
 * so [`activity_for_panes`] can read it. The override merges per-key over the
 * global config for THIS session only; the global file is never touched.
 *
 * Pure: never mutates the input `args` array.
 */
export function buildSpawnOverride(input: SpawnOverrideInput): SpawnOverride {
  const { program, args, paneId, sessionId, resume, usagePaths } = input;

  // Only `claude` panes are wrapped; everything else spawns verbatim.
  if (program !== 'claude') {
    return { args: [...args] };
  }

  const injected: string[] = [];

  // App-owned session id FIRST, so the overview can locate this exact agent's
  // transcript. Added even when the wrapper is unavailable (activity is decoupled
  // from the statusline snapshot).
  // When `resume` is true, use `--resume <id>` so the restored pane continues
  // from its prior transcript. Otherwise use `--session-id <id>` for fresh panes.
  if (sessionId) {
    if (resume) {
      injected.push('--resume', sessionId);
    } else {
      injected.push('--session-id', sessionId);
    }
  }

  // Per-session settings override. ALWAYS present for a claude pane:
  //  - `remoteControlAtStartup: false` keeps the transcript LOCAL + complete (the
  //    overview's activity reads it); the global default would bridge it to the
  //    cloud and leave only a stub behind.
  //  - `statusLine` points at the app's wrapper for the snapshot pipeline, but
  //    only when the usage paths resolved (a missing wrapper must never break a
  //    launch, so the statusline override is the only optional part).
  const settings: {
    remoteControlAtStartup: boolean;
    statusLine?: { type: string; command: string };
    hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>>;
  } = { remoteControlAtStartup: false };

  let env: Array<[string, string]> | undefined;
  if (usagePaths) {
    // Both command paths are shell-quoted (see quoteCommand): they live under a
    // spaced app-data path, and claude runs them through a shell.
    settings.statusLine = {
      type: STATUS_LINE_TYPE,
      command: quoteCommand(usagePaths.wrapperPath)
    };
    // The single event hook is wired into the FULL lifecycle event set. Each
    // invocation normalizes its event and delivers one JSON line over the
    // app-hosted Unix socket (AGENT_DESKTOP_SOCKET_PATH), feeding the overview's
    // event-sourced status + per-tool timeline. Pre/PostToolUse match ALL tools
    // (matcher '*') so every tool call produces a timeline entry; the pending
    // AskUserQuestion payload rides on its PreToolUse event (it is not in the
    // transcript until answered), replacing the old question.json sidecar.
    const hookCmd = { type: 'command', command: quoteCommand(usagePaths.eventHookPath) };
    settings.hooks = {
      SessionStart: [{ hooks: [hookCmd] }],
      UserPromptSubmit: [{ hooks: [hookCmd] }],
      PreToolUse: [{ matcher: '*', hooks: [hookCmd] }],
      PostToolUse: [{ matcher: '*', hooks: [hookCmd] }],
      Notification: [{ hooks: [hookCmd] }],
      Stop: [{ hooks: [hookCmd] }],
      SubagentStop: [{ hooks: [hookCmd] }],
      SessionEnd: [{ hooks: [hookCmd] }]
    };
    env = [
      ['AGENT_DESKTOP_PANE', paneId],
      ['AGENT_DESKTOP_SNAPSHOT_DIR', usagePaths.snapshotDir],
      ['AGENT_DESKTOP_SOCKET_PATH', usagePaths.socketPath]
    ];
  }
  injected.push('--settings', JSON.stringify(settings));

  return { args: [...injected, ...args], env };
}

/**
 * The `--mcp-config` JSON that attaches the bundled orchestration toolkit to a
 * launched coordinator session. A single stdio MCP server (`orchestration`) runs
 * the bundled adapter via `node <adapterPath>` with the control-socket path in its
 * env, so the adapter forwards each tool call to the Rust control socket.
 *
 * Shape matches Claude's `--mcp-config` stdio-server schema:
 *   { "mcpServers": { "<name>": { "command", "args", "env" } } }
 */
export interface McpToolkitConfig {
  mcpServers: {
    orchestration: {
      command: string;
      args: string[];
      env: { AGENT_DESKTOP_CONTROL_SOCKET: string };
    };
  };
}

/**
 * The MCP server name the toolkit is registered under. Tools therefore surface to
 * the coordinator as `mcp__orchestration__<tool>` (e.g. `mcp__orchestration__spawn_agent`).
 */
export const ORCHESTRATION_MCP_SERVER = 'orchestration';

/**
 * The env var the bundled adapter reads to find the control socket — must match the
 * Rust `orchestration::CONTROL_SOCKET_ENV` constant.
 */
export const CONTROL_SOCKET_ENV = 'AGENT_DESKTOP_CONTROL_SOCKET';

/**
 * Build the per-session `--mcp-config` content (task 3.6) that attaches the
 * orchestration toolkit to a coordinator `claude` launch. The coordinator-launch
 * task (6.2) passes the returned object (typically `JSON.stringify`-ed, or written
 * to a temp file) as `--mcp-config`.
 *
 *  - `adapterPath` — absolute path to the installed `orchestration-mcp.cjs`
 *    (resolved the same way as the wrapper / event-hook resources).
 *  - `socketPath`  — absolute path to the Rust control socket
 *    (`orchestration::CONTROL_SOCKET_ENV` value).
 *
 * Pure: depends only on its inputs.
 */
export function buildMcpToolkitConfig(adapterPath: string, socketPath: string): McpToolkitConfig {
  return {
    mcpServers: {
      [ORCHESTRATION_MCP_SERVER]: {
        command: 'node',
        args: [adapterPath],
        env: { [CONTROL_SOCKET_ENV]: socketPath }
      }
    }
  } as McpToolkitConfig;
}
