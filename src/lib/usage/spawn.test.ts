import { describe, expect, it } from 'vitest';
import { buildSpawnOverride, quoteCommand, type UsagePaths } from './spawn';

// Tests for the PURE spawn-override helper that wires `claude` panes THROUGH the
// app-managed statusline wrapper without ever touching the user's global
// ~/.claude/settings.json. The `it(...)` titles are the EXACT `#### Scenario:`
// names from the usage-dashboard spec (Requirement: Per-Session Statusline
// Override Without Touching Global Config) so the coverage gate can match them.

const PATHS: UsagePaths = {
  wrapperPath: '/Users/me/Library/Application Support/agent-desktop/bin/statusline-wrapper.js',
  snapshotDir: '/Users/me/Library/Application Support/agent-desktop/snapshots',
  eventHookPath: '/Users/me/Library/Application Support/agent-desktop/bin/event-hook.js',
  socketPath: '/Users/me/Library/Application Support/agent-desktop/events.sock'
};

/** The full hook event set the event hook is wired into, with Pre/Post matching all tools. */
function expectedHooks(eventHookPath: string) {
  const cmd = { type: 'command', command: `"${eventHookPath}"` };
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
    // Command paths are shell-quoted so the spaced app-data path survives claude's
    // shell invocation (the wrapper/hook silently never run otherwise).
    expect(parsed.statusLine).toEqual({ type: 'command', command: `"${PATHS.wrapperPath}"` });
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
    // The override object contains ONLY `remoteControlAtStartup` (keep the
    // transcript local), `statusLine.command` (the snapshot wrapper), and `hooks`
    // (the AskUserQuestion sidecar) — no other keys — so `claude --settings` merges
    // it per-key over the user's settings.json, leaving every other key (e.g.
    // permissions.allow) in effect.
    const parsed = JSON.parse(args[1]);
    expect(Object.keys(parsed)).toEqual(['remoteControlAtStartup', 'statusLine', 'hooks']);
    expect(parsed.remoteControlAtStartup).toBe(false);
    expect(parsed.statusLine.command).toBe(`"${PATHS.wrapperPath}"`);
    expect(parsed.hooks.PreToolUse[0].matcher).toBe('*');
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe(`"${PATHS.eventHookPath}"`);
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
    expect(args).toEqual(['--settings', '{"remoteControlAtStartup":false}', '--resume']);
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
      '{"remoteControlAtStartup":false}'
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
