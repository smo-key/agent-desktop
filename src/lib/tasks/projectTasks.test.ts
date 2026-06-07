import { describe, expect, it } from 'vitest';
import {
  TASKS_VERSION,
  addTask,
  removeTask,
  renameTask,
  defaultTaskName,
  defaultAgentName,
  parseTasks,
  serializeTasks,
  importLegacyTasks,
  tasksForProject,
  taskSpawnSpec,
  markRunningState,
  captureRunningState,
  autoRestartIds,
  type TaskDef,
  type TasksByProject
} from './projectTasks';

// Tests for the PURE project-terminals model (project-terminals capability). The
// `it(...)` titles match `#### Scenario:` names in the spec where a scenario is
// headless-testable; the rest are supporting unit tests. No Svelte/Tauri imports,
// so this runs under the default node Vitest environment.

function t(over: Partial<TaskDef> = {}): TaskDef {
  return {
    id: 'term-1',
    name: 'dev server',
    kind: 'terminal',
    command: 'npm run dev',
    cwd: null,
    ...over
  };
}

describe('project-terminals — Per-project terminal collections', () => {
  it('Terminal added to one project only', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', t({ id: 'a' }));
    expect(tasksForProject(map, 'web-app').map((x) => x.id)).toEqual(['a']);
    expect(tasksForProject(map, 'api')).toEqual([]);
  });

  it('Each project keeps its own collection', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', t({ id: 'a' }));
    map = addTask(map, 'web-app', t({ id: 'b' }));
    map = addTask(map, 'api', t({ id: 'c' }));
    expect(tasksForProject(map, 'web-app').map((x) => x.id)).toEqual(['a', 'b']);
    expect(tasksForProject(map, 'api').map((x) => x.id)).toEqual(['c']);
  });
});

describe('project-terminals — Create a terminal', () => {
  it('Create a shell terminal', () => {
    // A terminal with no command is the default shell; default name reflects that.
    const def = t({ id: 's', command: null, name: defaultTaskName(null) });
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', def);
    const stored = tasksForProject(map, 'web-app')[0];
    expect(stored.command).toBeNull();
    expect(stored.name).toBe('shell');
  });

  it('Create a terminal with a command', () => {
    const def = t({ id: 'c', command: 'npm run dev', name: defaultTaskName('npm run dev') });
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', def);
    const stored = tasksForProject(map, 'web-app')[0];
    expect(stored.command).toBe('npm run dev');
  });

  it('appends new terminals to the end of the project collection', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a' }));
    map = addTask(map, 'p', t({ id: 'b' }));
    expect(tasksForProject(map, 'p').map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('project-terminals — Rename a terminal', () => {
  it('Default name on creation', () => {
    expect(defaultTaskName('npm run dev')).toBe('npm run dev');
    expect(defaultTaskName('  npm   run   dev  ')).toBe('npm run dev');
    expect(defaultTaskName('node ./very/long/path/to/server.js --flag')).toMatch(/^node /);
    expect(defaultTaskName(null)).toBe('shell');
    expect(defaultTaskName('')).toBe('shell');
  });

  it('Rename persists', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', t({ id: 'a', name: 'old' }));
    map = renameTask(map, 'a', 'dev server');
    expect(tasksForProject(map, 'web-app')[0].name).toBe('dev server');
    // An empty/whitespace rename is ignored (keeps the prior name).
    map = renameTask(map, 'a', '   ');
    expect(tasksForProject(map, 'web-app')[0].name).toBe('dev server');
  });

  it('removeTerminal drops the entry from its project', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a' }));
    map = addTask(map, 'p', t({ id: 'b' }));
    map = removeTask(map, 'a');
    expect(tasksForProject(map, 'p').map((x) => x.id)).toEqual(['b']);
  });
});

describe('project-terminals — Persisted terminal definitions', () => {
  it('Definitions restored on restart', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', t({ id: 'a', name: 'dev', command: 'npm run dev', cwd: '/x' }));
    map = addTask(map, 'api', t({ id: 'b', name: 'sh', command: null, cwd: null }));
    const round = parseTasks(serializeTasks(map));
    expect(tasksForProject(round, 'web-app')[0]).toMatchObject({
      id: 'a',
      name: 'dev',
      command: 'npm run dev',
      cwd: '/x'
    });
    expect(tasksForProject(round, 'api')[0]).toMatchObject({ id: 'b', command: null, cwd: null });
  });

  it('Corrupt or missing store loads empty', () => {
    expect(parseTasks(null)).toEqual({});
    expect(parseTasks('')).toEqual({});
    expect(parseTasks('not json{')).toEqual({});
    expect(parseTasks('[1,2,3]')).toEqual({});
    expect(parseTasks('{"version":1}')).toEqual({});
  });

  it('serializes the versioned envelope', () => {
    const map = addTask({}, 'p', t({ id: 'a' }));
    const env = JSON.parse(serializeTasks(map));
    expect(env.version).toBe(TASKS_VERSION);
    expect(Object.keys(env.projects)).toEqual(['p']);
  });

  it('Runtime state is not persisted', () => {
    // wasRunning is the ONLY lifecycle hint persisted; live handles/exit codes are
    // never part of the model, so a round-trip preserves only the def fields.
    const map = addTask({}, 'p', t({ id: 'a', wasRunning: true }));
    const env = JSON.parse(serializeTasks(map));
    const stored = env.projects.p[0];
    expect(stored).not.toHaveProperty('paneId');
    expect(stored).not.toHaveProperty('running');
    expect(stored).not.toHaveProperty('exitCode');
    expect(stored.wasRunning).toBe(true);
  });

  it('drops empty project buckets on serialize', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a' }));
    map = removeTask(map, 'a');
    const env = JSON.parse(serializeTasks(map));
    expect(env.projects).toEqual({});
  });
});

describe('project-terminals — spawn spec', () => {
  it('Create a terminal with a command runs it through the login shell', () => {
    const spec = taskSpawnSpec(t({ command: 'npm run dev', cwd: null }), '/proj', '/bin/zsh');
    expect(spec).toEqual({ program: '/bin/zsh', args: ['-lc', 'npm run dev'], cwd: '/proj' });
  });

  it('Create a shell terminal spawns an interactive shell in the project cwd', () => {
    const spec = taskSpawnSpec(t({ command: null, cwd: null }), '/proj', '/bin/zsh');
    expect(spec).toEqual({ program: '/bin/zsh', args: [], cwd: '/proj' });
  });

  it('honors an explicit per-terminal cwd over the project path', () => {
    const spec = taskSpawnSpec(t({ command: null, cwd: '/custom' }), '/proj', '/bin/zsh');
    expect(spec.cwd).toBe('/custom');
  });
});

describe('project-terminals — Selective auto-restart on launch', () => {
  it('Previously running terminal auto-restarts', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a', wasRunning: true }));
    map = addTask(map, 'p', t({ id: 'b', wasRunning: false }));
    expect(autoRestartIds(map)).toEqual(['a']);
  });

  it('Previously stopped terminal stays stopped', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a', wasRunning: false }));
    map = addTask(map, 'p', t({ id: 'b' })); // wasRunning undefined => not restarted
    expect(autoRestartIds(map)).toEqual([]);
  });

  it('Running state captured at quit', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a' }));
    map = addTask(map, 'p', t({ id: 'b' }));
    // Capture: 'a' running, 'b' stopped.
    map = markRunningState(map, new Set(['a']));
    expect(tasksForProject(map, 'p').find((x) => x.id === 'a')?.wasRunning).toBe(true);
    expect(tasksForProject(map, 'p').find((x) => x.id === 'b')?.wasRunning).toBe(false);
    // The captured flags drive the next launch's auto-restart set.
    expect(autoRestartIds(map)).toEqual(['a']);
  });

  it('Running command captured at quit', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'p', t({ id: 'a' }));
    map = addTask(map, 'p', t({ id: 'b' }));
    // 'a' running a command (live title), 'b' stopped.
    map = captureRunningState(map, {
      a: { running: true, title: 'npm run dev' },
      b: { running: false }
    });
    const a = tasksForProject(map, 'p').find((x) => x.id === 'a');
    const b = tasksForProject(map, 'p').find((x) => x.id === 'b');
    expect(a?.wasRunning).toBe(true);
    expect(a?.lastCommand).toBe('npm run dev');
    expect(b?.wasRunning).toBe(false);
    expect(b?.lastCommand).toBeUndefined();
  });

  it('clears lastCommand for a terminal that is no longer running', () => {
    let map = addTask({}, 'p', t({ id: 'a', lastCommand: 'old cmd' }));
    map = captureRunningState(map, { a: { running: false } });
    expect(tasksForProject(map, 'p')[0].lastCommand).toBeUndefined();
  });

  it('round-trips lastCommand through persistence', () => {
    let map = addTask({}, 'p', t({ id: 'a' }));
    map = captureRunningState(map, { a: { running: true, title: 'vim x' } });
    const round = parseTasks(serializeTasks(map));
    expect(tasksForProject(round, 'p')[0].lastCommand).toBe('vim x');
  });
});

describe('project-terminals — Task kind (terminal | agent)', () => {
  it('Terminal task fields', () => {
    // A terminal task carries kind:'terminal', its command, no prompt, under its project.
    const def = t({ id: 'a', kind: 'terminal', command: 'npm run dev' });
    const round = parseTasks(serializeTasks(addTask({}, 'web-app', def)));
    const stored = tasksForProject(round, 'web-app')[0];
    expect(stored.kind).toBe('terminal');
    expect(stored.command).toBe('npm run dev');
    expect(stored.prompt).toBeUndefined();
    expect(tasksForProject(round, 'api')).toEqual([]);
  });

  it('Agent task fields', () => {
    // An agent task carries kind:'agent', a prompt, and command:null.
    const def = t({ id: 'g', kind: 'agent', command: null, prompt: 'fix the bug' });
    const round = parseTasks(serializeTasks(addTask({}, 'web-app', def)));
    const stored = tasksForProject(round, 'web-app')[0];
    expect(stored.kind).toBe('agent');
    expect(stored.prompt).toBe('fix the bug');
    expect(stored.command).toBeNull();
  });

  it('Per-project keying', () => {
    let map: TasksByProject = {};
    map = addTask(map, 'web-app', t({ id: 'a' }));
    map = addTask(map, 'api', t({ id: 'b' }));
    const round = parseTasks(serializeTasks(map));
    expect(tasksForProject(round, 'web-app').map((x) => x.id)).toEqual(['a']);
    expect(tasksForProject(round, 'api').map((x) => x.id)).toEqual(['b']);
  });

  it('Default name from command', () => {
    // A terminal task created without a name defaults it from the command.
    const def = t({ id: 'c', command: 'npm run build', name: defaultTaskName('npm run build') });
    expect(def.name).toBe('npm run build');
    // And an agent task can derive a tidy name from its prompt.
    expect(defaultAgentName('  fix   the   bug  ')).toBe('fix the bug');
    expect(defaultAgentName('')).toBe('agent');
  });

  it('Legacy terminals import', () => {
    // A legacy terminals.json envelope has no `kind` — every imported task is a terminal.
    const legacy = JSON.stringify({
      version: 1,
      projects: {
        'web-app': [{ id: 'a', name: 'dev', command: 'npm run dev', cwd: '/x' }],
        api: [{ id: 'b', name: 'sh', command: null, cwd: null }]
      }
    });
    const map = importLegacyTasks(legacy);
    const a = tasksForProject(map, 'web-app')[0];
    expect(a).toMatchObject({ id: 'a', name: 'dev', command: 'npm run dev', cwd: '/x' });
    expect(a.kind).toBe('terminal');
    const b = tasksForProject(map, 'api')[0];
    expect(b).toMatchObject({ id: 'b', name: 'sh', command: null, cwd: null });
    expect(b.kind).toBe('terminal');
  });

  it('Corrupt file falls back to empty', () => {
    expect(parseTasks('{ not json')).toEqual({});
    expect(parseTasks('not json{')).toEqual({});
    expect(parseTasks('[1,2,3]')).toEqual({});
    expect(parseTasks('null')).toEqual({});
    expect(importLegacyTasks('{ not json')).toEqual({});
  });

  it('Runtime state not persisted', () => {
    const env = JSON.parse(serializeTasks(addTask({}, 'p', t({ id: 'a' }))));
    const stored = env.projects.p[0];
    expect(stored).not.toHaveProperty('paneId');
    expect(stored).not.toHaveProperty('running');
    expect(stored).not.toHaveProperty('exitCode');
  });
});
