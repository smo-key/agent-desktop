import { describe, expect, it } from 'vitest';
import { buildSpawnOverride, type UsagePaths } from './spawn';

// Tests for the PURE spawn-override helper that wires `claude` panes THROUGH the
// app-managed statusline wrapper without ever touching the user's global
// ~/.claude/settings.json. The `it(...)` titles are the EXACT `#### Scenario:`
// names from the usage-dashboard spec (Requirement: Per-Session Statusline
// Override Without Touching Global Config) so the coverage gate can match them.

const PATHS: UsagePaths = {
  wrapperPath: '/Users/me/Library/Application Support/agent-desktop/bin/statusline-wrapper.js',
  snapshotDir: '/Users/me/Library/Application Support/agent-desktop/snapshots'
};

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
    expect(parsed).toEqual({
      statusLine: { type: 'command', command: PATHS.wrapperPath }
    });
    // The override is inline JSON (a per-session merge), never a file write —
    // nothing here points at or mutates ~/.claude/settings.json.
    expect(claude.args[1]).not.toContain('settings.json');
    // Existing args are preserved verbatim after the injected ones.
    expect(claude.args.slice(2)).toEqual(['--resume']);
    // The per-session env reaches the wrapper (statusLine.command).
    expect(claude.env).toEqual([
      ['AGENT_DESKTOP_PANE', 'pane-xyz'],
      ['AGENT_DESKTOP_SNAPSHOT_DIR', PATHS.snapshotDir]
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
    // The override object contains ONLY statusLine.command — no other keys — so
    // `claude --settings` merges it per-key over the user's settings.json,
    // leaving every other key (e.g. permissions.allow) in effect.
    const parsed = JSON.parse(args[1]);
    expect(Object.keys(parsed)).toEqual(['statusLine']);
    expect(parsed.statusLine.command).toBe(PATHS.wrapperPath);
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
    // If the wrapper path could not be resolved, claude still launches — just
    // without the override — rather than failing the session.
    const { args, env } = buildSpawnOverride({
      program: 'claude',
      args: ['--resume'],
      paneId: 'p1',
      usagePaths: null
    });
    expect(args).toEqual(['--resume']);
    expect(env).toBeUndefined();
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
});
