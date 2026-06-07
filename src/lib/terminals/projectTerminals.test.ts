import { describe, expect, it } from 'vitest';
import {
  TERMINALS_VERSION,
  addTerminal,
  removeTerminal,
  renameTerminal,
  defaultTerminalName,
  parseTerminals,
  serializeTerminals,
  terminalsForProject,
  terminalSpawnSpec,
  markRunningState,
  captureRunningState,
  autoRestartIds,
  type TerminalDef,
  type TerminalsByProject
} from './projectTerminals';

// Tests for the PURE project-terminals model (project-terminals capability). The
// `it(...)` titles match `#### Scenario:` names in the spec where a scenario is
// headless-testable; the rest are supporting unit tests. No Svelte/Tauri imports,
// so this runs under the default node Vitest environment.

function t(over: Partial<TerminalDef> = {}): TerminalDef {
  return {
    id: 'term-1',
    name: 'dev server',
    command: 'npm run dev',
    cwd: null,
    ...over
  };
}

describe('project-terminals — Per-project terminal collections', () => {
  it('Terminal added to one project only', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'web-app', t({ id: 'a' }));
    expect(terminalsForProject(map, 'web-app').map((x) => x.id)).toEqual(['a']);
    expect(terminalsForProject(map, 'api')).toEqual([]);
  });

  it('Each project keeps its own collection', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'web-app', t({ id: 'a' }));
    map = addTerminal(map, 'web-app', t({ id: 'b' }));
    map = addTerminal(map, 'api', t({ id: 'c' }));
    expect(terminalsForProject(map, 'web-app').map((x) => x.id)).toEqual(['a', 'b']);
    expect(terminalsForProject(map, 'api').map((x) => x.id)).toEqual(['c']);
  });
});

describe('project-terminals — Create a terminal', () => {
  it('Create a shell terminal', () => {
    // A terminal with no command is the default shell; default name reflects that.
    const def = t({ id: 's', command: null, name: defaultTerminalName(null) });
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'web-app', def);
    const stored = terminalsForProject(map, 'web-app')[0];
    expect(stored.command).toBeNull();
    expect(stored.name).toBe('shell');
  });

  it('Create a terminal with a command', () => {
    const def = t({ id: 'c', command: 'npm run dev', name: defaultTerminalName('npm run dev') });
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'web-app', def);
    const stored = terminalsForProject(map, 'web-app')[0];
    expect(stored.command).toBe('npm run dev');
  });

  it('appends new terminals to the end of the project collection', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a' }));
    map = addTerminal(map, 'p', t({ id: 'b' }));
    expect(terminalsForProject(map, 'p').map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('project-terminals — Rename a terminal', () => {
  it('Default name on creation', () => {
    expect(defaultTerminalName('npm run dev')).toBe('npm run dev');
    expect(defaultTerminalName('  npm   run   dev  ')).toBe('npm run dev');
    expect(defaultTerminalName('node ./very/long/path/to/server.js --flag')).toMatch(/^node /);
    expect(defaultTerminalName(null)).toBe('shell');
    expect(defaultTerminalName('')).toBe('shell');
  });

  it('Rename persists', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'web-app', t({ id: 'a', name: 'old' }));
    map = renameTerminal(map, 'a', 'dev server');
    expect(terminalsForProject(map, 'web-app')[0].name).toBe('dev server');
    // An empty/whitespace rename is ignored (keeps the prior name).
    map = renameTerminal(map, 'a', '   ');
    expect(terminalsForProject(map, 'web-app')[0].name).toBe('dev server');
  });

  it('removeTerminal drops the entry from its project', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a' }));
    map = addTerminal(map, 'p', t({ id: 'b' }));
    map = removeTerminal(map, 'a');
    expect(terminalsForProject(map, 'p').map((x) => x.id)).toEqual(['b']);
  });
});

describe('project-terminals — Persisted terminal definitions', () => {
  it('Definitions restored on restart', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'web-app', t({ id: 'a', name: 'dev', command: 'npm run dev', cwd: '/x' }));
    map = addTerminal(map, 'api', t({ id: 'b', name: 'sh', command: null, cwd: null }));
    const round = parseTerminals(serializeTerminals(map));
    expect(terminalsForProject(round, 'web-app')[0]).toMatchObject({
      id: 'a',
      name: 'dev',
      command: 'npm run dev',
      cwd: '/x'
    });
    expect(terminalsForProject(round, 'api')[0]).toMatchObject({ id: 'b', command: null, cwd: null });
  });

  it('Corrupt or missing store loads empty', () => {
    expect(parseTerminals(null)).toEqual({});
    expect(parseTerminals('')).toEqual({});
    expect(parseTerminals('not json{')).toEqual({});
    expect(parseTerminals('[1,2,3]')).toEqual({});
    expect(parseTerminals('{"version":1}')).toEqual({});
  });

  it('serializes the versioned envelope', () => {
    const map = addTerminal({}, 'p', t({ id: 'a' }));
    const env = JSON.parse(serializeTerminals(map));
    expect(env.version).toBe(TERMINALS_VERSION);
    expect(Object.keys(env.projects)).toEqual(['p']);
  });

  it('Runtime state is not persisted', () => {
    // wasRunning is the ONLY lifecycle hint persisted; live handles/exit codes are
    // never part of the model, so a round-trip preserves only the def fields.
    const map = addTerminal({}, 'p', t({ id: 'a', wasRunning: true }));
    const env = JSON.parse(serializeTerminals(map));
    const stored = env.projects.p[0];
    expect(stored).not.toHaveProperty('paneId');
    expect(stored).not.toHaveProperty('running');
    expect(stored).not.toHaveProperty('exitCode');
    expect(stored.wasRunning).toBe(true);
  });

  it('drops empty project buckets on serialize', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a' }));
    map = removeTerminal(map, 'a');
    const env = JSON.parse(serializeTerminals(map));
    expect(env.projects).toEqual({});
  });
});

describe('project-terminals — spawn spec', () => {
  it('Create a terminal with a command runs it through the login shell', () => {
    const spec = terminalSpawnSpec(t({ command: 'npm run dev', cwd: null }), '/proj', '/bin/zsh');
    expect(spec).toEqual({ program: '/bin/zsh', args: ['-lc', 'npm run dev'], cwd: '/proj' });
  });

  it('Create a shell terminal spawns an interactive shell in the project cwd', () => {
    const spec = terminalSpawnSpec(t({ command: null, cwd: null }), '/proj', '/bin/zsh');
    expect(spec).toEqual({ program: '/bin/zsh', args: [], cwd: '/proj' });
  });

  it('honors an explicit per-terminal cwd over the project path', () => {
    const spec = terminalSpawnSpec(t({ command: null, cwd: '/custom' }), '/proj', '/bin/zsh');
    expect(spec.cwd).toBe('/custom');
  });
});

describe('project-terminals — Selective auto-restart on launch', () => {
  it('Previously running terminal auto-restarts', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a', wasRunning: true }));
    map = addTerminal(map, 'p', t({ id: 'b', wasRunning: false }));
    expect(autoRestartIds(map)).toEqual(['a']);
  });

  it('Previously stopped terminal stays stopped', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a', wasRunning: false }));
    map = addTerminal(map, 'p', t({ id: 'b' })); // wasRunning undefined => not restarted
    expect(autoRestartIds(map)).toEqual([]);
  });

  it('Running state captured at quit', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a' }));
    map = addTerminal(map, 'p', t({ id: 'b' }));
    // Capture: 'a' running, 'b' stopped.
    map = markRunningState(map, new Set(['a']));
    expect(terminalsForProject(map, 'p').find((x) => x.id === 'a')?.wasRunning).toBe(true);
    expect(terminalsForProject(map, 'p').find((x) => x.id === 'b')?.wasRunning).toBe(false);
    // The captured flags drive the next launch's auto-restart set.
    expect(autoRestartIds(map)).toEqual(['a']);
  });

  it('Running command captured at quit', () => {
    let map: TerminalsByProject = {};
    map = addTerminal(map, 'p', t({ id: 'a' }));
    map = addTerminal(map, 'p', t({ id: 'b' }));
    // 'a' running a command (live title), 'b' stopped.
    map = captureRunningState(map, {
      a: { running: true, title: 'npm run dev' },
      b: { running: false }
    });
    const a = terminalsForProject(map, 'p').find((x) => x.id === 'a');
    const b = terminalsForProject(map, 'p').find((x) => x.id === 'b');
    expect(a?.wasRunning).toBe(true);
    expect(a?.lastCommand).toBe('npm run dev');
    expect(b?.wasRunning).toBe(false);
    expect(b?.lastCommand).toBeUndefined();
  });

  it('clears lastCommand for a terminal that is no longer running', () => {
    let map = addTerminal({}, 'p', t({ id: 'a', lastCommand: 'old cmd' }));
    map = captureRunningState(map, { a: { running: false } });
    expect(terminalsForProject(map, 'p')[0].lastCommand).toBeUndefined();
  });

  it('round-trips lastCommand through persistence', () => {
    let map = addTerminal({}, 'p', t({ id: 'a' }));
    map = captureRunningState(map, { a: { running: true, title: 'vim x' } });
    const round = parseTerminals(serializeTerminals(map));
    expect(terminalsForProject(round, 'p')[0].lastCommand).toBe('vim x');
  });
});
