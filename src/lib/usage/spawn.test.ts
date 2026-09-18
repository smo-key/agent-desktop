import { describe, expect, it } from 'vitest';
import {
  buildMcpToolkitConfig,
  buildSpawnOverride,
  nodeCommand,
  quoteCommand,
  type UsagePaths
} from './spawn';

// Tests for the PURE spawn-override helper that wires `claude` panes THROUGH the
// app-managed statusline wrapper without ever touching the user's global
// ~/.claude/settings.json. The `it(...)` titles are the EXACT `#### Scenario:`
// names from the usage-dashboard spec (Requirement: Per-Session Statusline
// Override Without Touching Global Config) so the coverage gate can match them.

const PATHS: UsagePaths = {
  wrapperPath: '/Users/me/Library/Application Support/agent-desktop/bin/statusline-wrapper.js',
  snapshotDir: '/Users/me/Library/Application Support/agent-desktop/snapshots',
  eventHookPath: '/Users/me/Library/Application Support/agent-desktop/bin/event-hook.js',
  socketPath: '/Users/me/Library/Application Support/agent-desktop/events.sock',
  adapterPath: '/Users/me/Library/Application Support/agent-desktop/bin/orchestration-mcp.js',
  controlSocketPath: '/Users/me/Library/Application Support/agent-desktop/control.sock'
};

/** The full hook event set the event hook is wired into, with Pre/Post matching all tools. */
function expectedHooks(eventHookPath: string) {
  const cmd = { type: 'command', command: `node "${eventHookPath}"` };
  return {
    SessionStart: [{ hooks: [cmd] }],
    UserPromptSubmit: [{ hooks: [cmd] }],
    PreToolUse: [{ matcher: '*', hooks: [cmd] }],
    PostToolUse: [{ matcher: '*', hooks: [cmd] }],
    Notification: [{ hooks: [cmd] }],
    Stop: [{ hooks: [cmd] }],
    SubagentStop: [{ hooks: [cmd] }],
    SessionEnd: [{ hooks: [cmd] }]
  };
}

describe('buildSpawnOverride', () => {
  // The headline scenario: a claude spawn carries the per-session --settings
  // override (statusLine.command = wrapper) + the two env vars, while a shell
  // spawn carries NEITHER — so the per-session override is the ONLY mechanism
  // and the user's global settings.json is never read or written by the app.
  it('Global config left byte-identical', () => {
    // claude: gets the inline --settings override and the env, nothing global.
    const claude = buildSpawnOverride({
      program: 'claude',
      args: ['--resume'],
      paneId: 'pane-xyz',
      usagePaths: PATHS
    });

    expect(claude.args[0]).toBe('--settings');
    const parsed = JSON.parse(claude.args[1]);
    expect(parsed.remoteControlAtStartup).toBe(false);
    // Claude's built-in agent view (←← opens it; ← backgrounds/detaches the session,
    // exiting the local PTY) conflicts with agent-desktop's own agents panel — disable
    // it per-session so an arrow keypress never archives a live session out from under
    // the user.
    expect(parsed.disableAgentView).toBe(true);
    // Command paths are shell-quoted so the spaced app-data path survives claude's
    // shell invocation (the wrapper/hook silently never run otherwise).
    expect(parsed.statusLine).toEqual({ type: 'command', command: `node "${PATHS.wrapperPath}"` });
    // The single event hook is wired into the full lifecycle event set so the
    // overview's status + per-tool timeline are event-sourced.
    expect(parsed.hooks).toEqual(expectedHooks(PATHS.eventHookPath));
    // The override is inline JSON (a per-session merge), never a file write —
    // nothing here points at or mutates ~/.claude/settings.json.
    expect(claude.args[1]).not.toContain('settings.json');
    // Existing args are preserved verbatim after the injected ones.
    expect(claude.args.slice(2)).toEqual(['--resume']);
    // The per-session env reaches the wrapper (statusLine.command) and the event
    // hook (AGENT_DESKTOP_SOCKET_PATH).
    expect(claude.env).toEqual([
      ['AGENT_DESKTOP_PANE', 'pane-xyz'],
      ['AGENT_DESKTOP_SNAPSHOT_DIR', PATHS.snapshotDir],
      ['AGENT_DESKTOP_SOCKET_PATH', PATHS.socketPath]
    ]);

    // shell: no --settings override, no AGENT_DESKTOP_* env — spawns unchanged,
    // so it likewise never involves the global config.
    const shell = buildSpawnOverride({
      program: '/bin/zsh',
      args: ['-l'],
      paneId: 'pane-xyz',
      usagePaths: PATHS
    });
    expect(shell.args).toEqual(['-l']);
    expect(shell.args).not.toContain('--settings');
    expect(shell.env).toBeUndefined();
  });

  it('Inline settings override merges per-key', () => {
    const { args } = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      usagePaths: PATHS
    });
    // The override object contains ONLY `remoteControlAtStartup` (keep the transcript
    // local), `disableAgentView` (Claude's arrow-key agent view conflicts with ours),
    // `statusLine.command` (the snapshot wrapper), and `hooks` (the event pipeline) — no
    // other keys — so `claude --settings` merges it per-key over the user's settings.json,
    // leaving every other key (e.g. permissions.allow) in effect.
    const parsed = JSON.parse(args[1]);
    expect(Object.keys(parsed)).toEqual([
      'remoteControlAtStartup',
      'disableAgentView',
      'statusLine',
      'hooks'
    ]);
    expect(parsed.remoteControlAtStartup).toBe(false);
    expect(parsed.statusLine.command).toBe(`node "${PATHS.wrapperPath}"`);
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('*');
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe(`node "${PATHS.eventHookPath}"`);
  });

  it('Full event set registered at spawn', () => {
    // The event hook is registered for every lifecycle event, Pre/PostToolUse
    // match ALL tools, and the socket path reaches the spawned process env.
    const { args, env } = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'pane-full',
      sessionId: 'sess-full',
      usagePaths: PATHS
    });
    const parsed = JSON.parse(args[args.indexOf('--settings') + 1]);
    expect(parsed.hooks).toEqual(expectedHooks(PATHS.eventHookPath));
    expect(Object.keys(parsed.hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'Stop',
      'SubagentStop',
      'SessionEnd'
    ]);
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('*');
    expect(parsed.hooks.PostToolUse[0].matcher).toBe('*');
    const map = new Map(env);
    expect(map.get('AGENT_DESKTOP_SOCKET_PATH')).toBe(PATHS.socketPath);
  });

  it('Pane id passed into the spawned process env', () => {
    const { env } = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'pane-uuid-123',
      usagePaths: PATHS
    });
    const map = new Map(env);
    expect(map.get('AGENT_DESKTOP_PANE')).toBe('pane-uuid-123');
    expect(map.get('AGENT_DESKTOP_SNAPSHOT_DIR')).toBe(PATHS.snapshotDir);
  });

  it('claude spawns unwrapped when usage paths are unavailable', () => {
    // If the wrapper path could not be resolved, claude still launches WITHOUT the
    // statusline wrapper or its env — but it ALWAYS carries the inline `--settings`
    // disabling remote-control, so the transcript stays local + complete for the
    // overview's activity (a missing wrapper must never bridge the session away).
    const { args, env } = buildSpawnOverride({
      program: 'claude',
      args: ['--resume'],
      paneId: 'p1',
      usagePaths: null
    });
    expect(args).toEqual([
      '--settings',
      '{"remoteControlAtStartup":false,"disableAgentView":true}',
      '--resume'
    ]);
    expect(env).toBeUndefined();
  });

  it('Agent launched with an app-owned session id', () => {
    // A claude pane carries `--session-id <uuid>` (BEFORE --settings) so the
    // overview can locate this exact agent's transcript; it is injected even when
    // the wrapper is unavailable (activity is decoupled from the snapshot).
    const wrapped = buildSpawnOverride({
      program: 'claude',
      args: ['--resume'],
      paneId: 'p1',
      sessionId: 'sess-uuid-1',
      usagePaths: PATHS
    });
    expect(wrapped.args.slice(0, 2)).toEqual(['--session-id', 'sess-uuid-1']);
    expect(wrapped.args[2]).toBe('--settings');
    expect(wrapped.args.slice(-1)).toEqual(['--resume']);

    const unwrapped = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sess-uuid-2',
      usagePaths: null
    });
    // Still carries `--session-id` AND the remote-control-disabling `--settings`,
    // just no statusline wrapper.
    expect(unwrapped.args).toEqual([
      '--session-id',
      'sess-uuid-2',
      '--settings',
      '{"remoteControlAtStartup":false,"disableAgentView":true}'
    ]);
    expect(unwrapped.env).toBeUndefined();

    // A shell pane never gets a session id.
    const shell = buildSpawnOverride({
      program: '/bin/zsh',
      args: [],
      paneId: 'p1',
      sessionId: 'ignored',
      usagePaths: PATHS
    });
    expect(shell.args).toEqual([]);
  });

  it('quoteCommand wraps a spaced app-data path so the shell does not split it', () => {
    // The real install path: `~/Library/Application Support/…` has a space, which
    // breaks claude's shell invocation of the command unless quoted.
    const spaced = '/Users/me/Library/Application Support/agent-desktop/bin/question-hook.js';
    expect(quoteCommand(spaced)).toBe(`"${spaced}"`);
    // Chars special inside double quotes are escaped.
    expect(quoteCommand('/x/$HOME/`b`/"c"/a.js')).toBe('"/x/\\$HOME/\\`b\\`/\\"c\\"/a.js"');
  });

  it('Hooks fire on Windows', () => {
    // Windows honors NEITHER the `#!/usr/bin/env node` shebang nor the executable
    // bit, so a bare script path as the hook command never runs. Because a hook
    // that fails to run is SILENT, that would disable the whole event pipeline —
    // and every agent's derived status with it — showing no error at all.
    // The command must therefore invoke `node` explicitly.
    const winPath = 'C:\\Users\\dev\\AppData\\Roaming\\agent desktop\\bin\\event-hook.cjs';
    const { args } = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      usagePaths: { ...PATHS, eventHookPath: winPath, wrapperPath: winPath }
    });
    const parsed = JSON.parse(args[1]);

    for (const [event, entries] of Object.entries(parsed.hooks)) {
      const command = (entries as Array<{ hooks: Array<{ command: string }> }>)[0].hooks[0].command;
      expect(command.startsWith('node '), `${event} does not invoke node: ${command}`).toBe(true);
      // The spaced path stays quoted, so the shell cannot split it, and the
      // separators are forward slashes — `quoteCommand` escapes `\` for POSIX
      // shells, but cmd.exe treats `\` literally, so an escaped Windows path
      // would reach node with doubled separators. Node accepts `/` on Windows.
      expect(command).toBe('node "C:/Users/dev/AppData/Roaming/agent desktop/bin/event-hook.cjs"');
      expect(command).not.toContain('\\\\');
    }
    // The statusline wrapper is invoked the same way.
    expect(parsed.statusLine.command).toBe(
      'node "C:/Users/dev/AppData/Roaming/agent desktop/bin/event-hook.cjs"'
    );
  });

  it('Hooks continue to fire on Unix', () => {
    // The same single code path on macOS/Linux — not a regression, since the
    // shebang was `/usr/bin/env node`, so `node` already had to be on PATH.
    const { args } = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      usagePaths: PATHS
    });
    const parsed = JSON.parse(args[1]);
    expect(parsed.hooks).toEqual(expectedHooks(PATHS.eventHookPath));
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe(`node "${PATHS.eventHookPath}"`);
    // Every lifecycle event still registered — none dropped by the change.
    expect(Object.keys(parsed.hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'Notification',
      'Stop',
      'SubagentStop',
      'SessionEnd'
    ]);
  });

  it('nodeCommand quotes the script path but not the interpreter', () => {
    expect(nodeCommand('/a b/c.cjs')).toBe('node "/a b/c.cjs"');
    // Shell-special characters inside the path are still escaped.
    expect(nodeCommand('/x/$H/`b`.cjs')).toBe('node "/x/\\$H/\\`b\\`.cjs"');
    // A Windows path is normalized to forward slashes (see toNodePath).
    expect(nodeCommand('C:\\a b\\c.cjs')).toBe('node "C:/a b/c.cjs"');
    // A Unix path containing a literal backslash is NOT treated as a Windows
    // path, so it keeps its escaping.
    expect(nodeCommand('/tmp/od\\d.cjs')).toBe('node "/tmp/od\\\\d.cjs"');
  });

  it('does not mutate the input args array', () => {
    const input = ['--resume'];
    buildSpawnOverride({
      program: 'claude',
      args: input,
      paneId: 'p1',
      usagePaths: PATHS
    });
    expect(input).toEqual(['--resume']);
  });

  it('Resume flag emits --resume instead of --session-id', () => {
    // A restored claude pane with resume:true must use `--resume <id>` so it
    // continues the prior transcript; `--session-id` must NOT appear.
    const resumed = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'pane-r',
      sessionId: 'sess-resume-1',
      resume: true,
      usagePaths: PATHS
    });
    expect(resumed.args.slice(0, 2)).toEqual(['--resume', 'sess-resume-1']);
    expect(resumed.args[2]).toBe('--settings');
    expect(resumed.args).not.toContain('--session-id');

    // Without resume, the existing --session-id behaviour is unchanged.
    const fresh = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'pane-f',
      sessionId: 'sess-fresh-1',
      resume: false,
      usagePaths: PATHS
    });
    expect(fresh.args.slice(0, 2)).toEqual(['--session-id', 'sess-fresh-1']);
    expect(fresh.args[2]).toBe('--settings');
    expect(fresh.args).not.toContain('--resume');

    // resume:true without a sessionId is a no-op (no flag injected).
    const noId = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'pane-n',
      resume: true,
      usagePaths: null
    });
    expect(noId.args).not.toContain('--resume');
    expect(noId.args).not.toContain('--session-id');
  });
});

describe('buildMcpToolkitConfig', () => {
  // Task 3.6: the per-session --mcp-config a toolkit-mounting launch consumes.
  it('builds an mcp-config naming the bundled adapter run via node with the socket + projectId env', () => {
    const cfg = buildMcpToolkitConfig(
      '/Users/me/Library/Application Support/agent-desktop/bin/orchestration-mcp.js',
      '/Users/me/Library/Application Support/agent-desktop/control.sock',
      'proj-coord-1'
    );
    expect(cfg).toEqual({
      mcpServers: {
        orchestration: {
          command: 'node',
          args: ['/Users/me/Library/Application Support/agent-desktop/bin/orchestration-mcp.js'],
          env: {
            AGENT_DESKTOP_CONTROL_SOCKET:
              '/Users/me/Library/Application Support/agent-desktop/control.sock',
            // The launching agent's own project id rides into the adapter so it can stamp
            // it into every forwarded tool call's args (the executor scopes on it).
            AGENT_DESKTOP_PROJECT_ID: 'proj-coord-1'
          }
        }
      }
    });
    // Round-trips through JSON (it is passed as --mcp-config content).
    expect(JSON.parse(JSON.stringify(cfg))).toEqual(cfg);
  });
});

describe('buildSpawnOverride — copilot backend (agent-backends)', () => {
  const paths = {
    wrapperPath: '/app/bin/statusline-wrapper.js',
    snapshotDir: '/app/snapshots',
    eventHookPath: '/app/bin/event-hook.js',
    socketPath: '/tmp/sock',
    adapterPath: '/app/bin/orchestration-mcp.js',
    controlSocketPath: '/tmp/ctl'
  };

  it('Copilot spawn is minimal and clean', () => {
    // Fresh copilot pane: backend args + pane env only — no --settings, no
    // hooks, no statusline, and the user's ~/.copilot config untouched.
    const out = buildSpawnOverride({
      program: 'copilot',
      args: [],
      paneId: 'P1',
      sessionId: 'S1',
      usagePaths: paths
    });
    expect(out.args).toEqual(['--session-id', 'S1', '--no-remote']);
    expect(out.args.join(' ')).not.toContain('--settings');
    expect(out.env).toEqual([
      ['AGENT_DESKTOP_PANE', 'P1'],
      ['AGENT_DESKTOP_SNAPSHOT_DIR', '/app/snapshots']
    ]);
  });

  it('copilot restore resumes by the app-minted id', () => {
    const out = buildSpawnOverride({
      program: 'copilot',
      args: ['--extra'],
      paneId: 'P1',
      sessionId: 'S1',
      resume: true,
      usagePaths: null
    });
    expect(out.args).toEqual(['--resume', 'S1', '--no-remote', '--extra']);
    expect(out.env).toEqual([['AGENT_DESKTOP_PANE', 'P1']]);
  });

  it('claude spawn behavior is unchanged by the registry', () => {
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'P1',
      sessionId: 'S1',
      usagePaths: paths
    });
    expect(out.args[0]).toBe('--session-id');
    expect(out.args).toContain('--settings');
  });
});

// ---------------------------------------------------------------------------
// WSL launch (`wsl-agent-launch`). The `it(...)` titles are the EXACT
// `#### Scenario:` names from that capability's spec.
// ---------------------------------------------------------------------------

/** Windows-shaped usage paths, as they'd be on the machine that reported this. */
const WIN_PATHS: UsagePaths = {
  wrapperPath: 'C:/Users/VedanshPatel/AppData/Roaming/com.arthur.agent-desktop/bin/statusline-wrapper.js',
  snapshotDir: 'C:/Users/VedanshPatel/AppData/Roaming/com.arthur.agent-desktop/snapshots',
  eventHookPath: 'C:/Users/VedanshPatel/AppData/Roaming/com.arthur.agent-desktop/bin/event-hook.js',
  socketPath: '\\\\.\\pipe\\agent-desktop-events-1234',
  adapterPath: 'C:/Users/VedanshPatel/AppData/Roaming/com.arthur.agent-desktop/bin/orchestration-mcp.js',
  controlSocketPath: '\\\\.\\pipe\\agent-desktop-control-1234'
};

const WSL_SHELL =
  'C:\\Program Files\\WindowsApps\\CanonicalGroupLimited.Ubuntu_2204\\ubuntu.exe';
const WSL_CWD = '\\\\wsl.localhost\\Ubuntu\\home\\v-patel\\source\\data-flow-central';

describe('buildSpawnOverride — WSL launch (wsl-agent-launch)', () => {
  it('Agent session in a WSL project folder', () => {
    // THE regression this capability exists to prevent: spawning a bare
    // `claude` as a Windows image when it only exists inside the distro.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL,
      executable: '/home/v-patel/.local/bin/claude',
      nodeAvailable: true
    });

    expect(out.program).toBe('wsl.exe');
    expect(out.args.slice(0, 3)).toEqual(['-d', 'Ubuntu', '--']);
    // The cwd is handed to the distro as a Linux path, not a UNC one.
    expect(out.args).toContain('/home/v-patel/source/data-flow-central');
    expect(out.args).toContain('/home/v-patel/.local/bin/claude');
    // The agent's own flags survive intact, after the executable.
    const exeIdx = out.args.indexOf('/home/v-patel/.local/bin/claude');
    expect(out.args[exeIdx + 1]).toBe('--session-id');
    expect(out.args[exeIdx + 2]).toBe('sid-1');
  });

  it('A WSL-launched pane is still an agent pane', () => {
    // The pane's REGISTRY program must stay the kind: backendForProgram is a
    // literal `=== 'claude'` check that persistence, status derivation and the
    // subagent rows all key on. This assertion exists because breaking it
    // fails SILENTLY — the session would launch and simply stop being an agent.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL,
      executable: '/home/v-patel/.local/bin/claude'
    });
    // `program` here is the SPAWN image, deliberately distinct from the pane's
    // recorded kind — which the caller never overwrites.
    expect(out.program).toBe('wsl.exe');
    expect(out.program).not.toBe('claude');
  });

  it('Socket-delivered events are omitted, not broken', () => {
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL
    });
    const settings = JSON.parse(out.args[out.args.indexOf('--settings') + 1]);
    // No hooks at all — a hook that cannot reach its socket fails SILENTLY,
    // which is worse than not being configured.
    expect(settings.hooks).toBeUndefined();
    // And the unreachable pipe address is not handed over either.
    const envKeys = (out.env ?? []).map(([k]) => k);
    expect(envKeys).not.toContain('AGENT_DESKTOP_SOCKET_PATH');
  });

  it('Env-addressed pipelines are omitted, not broken', () => {
    // The correction an adversarial review forced: Windows environment variables
    // do NOT cross into a distro without WSLENV, which nothing sets. The
    // statusline wrapper writes NOTHING unless both AGENT_DESKTOP_PANE and
    // AGENT_DESKTOP_SNAPSHOT_DIR are set, so retaining it would have cost a node
    // process per render to produce nothing. `node` was never the constraint.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL
    });
    const settings = JSON.parse(out.args[out.args.indexOf('--settings') + 1]);
    expect(settings.statusLine).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
    const envKeys = (out.env ?? []).map(([k]) => k);
    expect(envKeys).not.toContain('AGENT_DESKTOP_SNAPSHOT_DIR');
    expect(envKeys).not.toContain('AGENT_DESKTOP_SOCKET_PATH');
    // The session still launches — that is the whole point.
    expect(out.program).toBe('wsl.exe');
  });

  it('A WSL launch carries no Windows cwd', () => {
    // The directory is applied by the `cd` INSIDE the distro. Handing
    // CreateProcessW the original \\wsl.localhost\… UNC path as wsl.exe's own
    // cwd is what produces os error 3, so the override must say "no cwd"
    // explicitly rather than leave the caller to fall back to it.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL
    });
    expect(out.cwd).toBeUndefined();
    expect(out.args).toContain('/home/v-patel/source/data-flow-central');
  });

  it('honours an explicit executable off the WSL path', () => {
    // The setting is offered on every platform, so discarding it off-WSL made
    // the field silently inert — worse than not offering it at all.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: PATHS,
      cwd: '/Users/me/src',
      shell: '/bin/zsh',
      executable: '/opt/homebrew/bin/claude'
    });
    expect(out.program).toBe('/opt/homebrew/bin/claude');
    expect(out.cwd).toBe('/Users/me/src');
    // Still a fully-wired claude launch.
    const settings = JSON.parse(out.args[out.args.indexOf('--settings') + 1]);
    expect(settings.hooks).toEqual(expectedHooks(PATHS.eventHookPath));
  });

  it('Correctness settings are unconditional', () => {
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL
    });
    const settings = JSON.parse(out.args[out.args.indexOf('--settings') + 1]);
    // These keep the transcript local and stop an arrow key archiving the
    // session. They are correctness, not observability — always applied.
    expect(settings.remoteControlAtStartup).toBe(false);
    expect(settings.disableAgentView).toBe(true);
  });

  it('A non-WSL shell is unaffected', () => {
    // The regression guard: with a normal shell the output must be exactly what
    // it was before this capability existed.
    const base = {
      program: 'claude' as const,
      args: ['--extra'],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: PATHS
    };
    const before = buildSpawnOverride(base);
    const after = buildSpawnOverride({
      ...base,
      cwd: '/Users/me/src',
      shell: '/bin/zsh',
      executable: 'claude'
    });
    expect(after.args).toEqual(before.args);
    expect(after.env).toEqual(before.env);
    expect(after.program).toBe('claude');
    expect(after.cwd).toBe('/Users/me/src');
    // The hooks are still fully wired off the WSL path.
    const settings = JSON.parse(after.args[after.args.indexOf('--settings') + 1]);
    expect(settings.hooks).toEqual(expectedHooks(PATHS.eventHookPath));
  });

  it('wraps a copilot pane the same way', () => {
    const out = buildSpawnOverride({
      program: 'copilot',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-2',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL,
      executable: '/home/v-patel/.local/bin/copilot'
    });
    expect(out.program).toBe('wsl.exe');
    expect(out.args).toContain('/home/v-patel/.local/bin/copilot');
    expect(out.args).toContain('--no-remote');
  });

  it('falls back to the bare program when nothing was detected', () => {
    // Detection is ADVISORY: an empty probe must still produce a launch, with
    // the bare name resolved by the login profile the `-lc` sources.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      usagePaths: null,
      cwd: WSL_CWD,
      shell: WSL_SHELL,
      executable: null
    });
    expect(out.program).toBe('wsl.exe');
    expect(out.args).toContain('claude');
  });

  it('leaves a shell pane alone', () => {
    // A shell pane's program IS the WSL launcher, so it already runs inside the
    // distro. Double-wrapping it would be nonsense.
    const out = buildSpawnOverride({
      program: WSL_SHELL,
      args: [],
      paneId: 'p1',
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL
    });
    expect(out.program).toBe(WSL_SHELL);
    expect(out.args).toEqual([]);
  });
});

describe('wsl-agent-launch — restore', () => {
  it('A restored WSL pane', () => {
    // A restored pane resumes its transcript AND is still wrapped: the WSL
    // decision is a property of the launch environment, not of how the pane
    // came to exist, so it must hold on restore exactly as on first launch.
    const out = buildSpawnOverride({
      program: 'claude',
      args: [],
      paneId: 'p1',
      sessionId: 'sid-1',
      resume: true,
      usagePaths: WIN_PATHS,
      cwd: WSL_CWD,
      shell: WSL_SHELL,
      executable: '/home/v-patel/.local/bin/claude'
    });
    expect(out.program).toBe('wsl.exe');
    const exeIdx = out.args.indexOf('/home/v-patel/.local/bin/claude');
    expect(out.args[exeIdx + 1]).toBe('--resume');
    expect(out.args[exeIdx + 2]).toBe('sid-1');
  });
});
