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
  serializeProjectTasks,
  parseProjectTasks,
  parseProjectConfig,
  serializeProjectConfig,
  PROJECT_CONFIG_VERSION,
  type TaskDef,
  type TasksByProject,
  type ProjectConfig
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

  it('Close-on-complete choice persists', () => {
    // A terminal whose user unticked "Close automatically when complete" persists
    // closeOnComplete:false so the keep-open choice survives a restart; a default
    // task stores no flag (asserted in the sibling test below).
    const map = addTask({}, 'p', t({ id: 'a', closeOnComplete: false }));
    const round = parseTasks(serializeTasks(map));
    expect(tasksForProject(round, 'p')[0].closeOnComplete).toBe(false);
  });

  it('omits closeOnComplete when at its default (close)', () => {
    // The default (close on success) is the ABSENCE of the flag — a legacy/normal
    // terminal carries no closeOnComplete key, keeping the on-disk file tidy.
    const map = addTask({}, 'p', t({ id: 'a' }));
    const stored = JSON.parse(serializeTasks(map)).projects.p[0];
    expect(stored).not.toHaveProperty('closeOnComplete');
    // And a def parsed without the flag leaves it undefined (⇒ close).
    expect(parseTasks(serializeTasks(map)).p[0].closeOnComplete).toBeUndefined();
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

describe('project-terminals — Per-project sanitized tasks file', () => {
  it('round-trips a defs array through the flat envelope', () => {
    const defs: TaskDef[] = [
      t({ id: 'a', name: 'dev', command: 'npm run dev', cwd: '/x' }),
      t({ id: 'g', kind: 'agent', command: null, prompt: 'fix the bug' })
    ];
    const round = parseProjectTasks(serializeProjectTasks(defs));
    expect(round).toEqual(defs);
  });

  it('Per-project file', () => {
    // Project P's tasks persist to its own flat `{ version, tasks: [...] }`
    // envelope, containing only P's tasks (no projectId keying).
    const defs: TaskDef[] = [t({ id: 'a' }), t({ id: 'b' })];
    const env = JSON.parse(serializeProjectTasks(defs));
    expect(env.version).toBe(TASKS_VERSION);
    expect(env.tasks.map((x: TaskDef) => x.id)).toEqual(['a', 'b']);
    expect(env).not.toHaveProperty('projects');
  });

  it('Flat per-project envelope', () => {
    // serializeProjectTasks yields a flat `{ version, tasks: [...] }` envelope
    // (no projectId keying).
    const env = JSON.parse(serializeProjectTasks([t({ id: 'a' })]));
    expect(env.version).toBe(TASKS_VERSION);
    expect(Array.isArray(env.tasks)).toBe(true);
    expect(env.tasks[0].id).toBe('a');
    expect(env).not.toHaveProperty('projects');
  });

  it('Restore hints stripped', () => {
    const defs: TaskDef[] = [
      t({ id: 'a', wasRunning: true, lastCommand: 'vim x' })
    ];
    const env = JSON.parse(serializeProjectTasks(defs));
    expect(env.tasks[0]).not.toHaveProperty('wasRunning');
    expect(env.tasks[0]).not.toHaveProperty('lastCommand');
    // The retained fields survive.
    expect(env.tasks[0]).toMatchObject({ id: 'a', name: 'dev server', command: 'npm run dev' });
  });

  it('Definition fields kept', () => {
    const defs: TaskDef[] = [
      t({ id: 'a', cwd: '/custom', closeOnComplete: false })
    ];
    const env = JSON.parse(serializeProjectTasks(defs));
    expect(env.tasks[0].cwd).toBe('/custom');
    expect(env.tasks[0].closeOnComplete).toBe(false);
  });

  it('serializes the array given (does not drop empty)', () => {
    expect(JSON.parse(serializeProjectTasks([])).tasks).toEqual([]);
  });

  it('Missing file is empty', () => {
    // A missing/empty project tasks file (null / '' / missing) parses to [] without throwing.
    expect(parseProjectTasks(null)).toEqual([]);
    expect(parseProjectTasks(undefined)).toEqual([]);
    expect(parseProjectTasks('')).toEqual([]);
    expect(parseProjectTasks('{}')).toEqual([]);
    expect(parseProjectTasks('[]')).toEqual([]);
    expect(parseProjectTasks('not json')).toEqual([]);
    expect(parseProjectTasks('{"version":1,"tasks":"x"}')).toEqual([]);
    expect(parseProjectTasks('null')).toEqual([]);
  });

  it('parseProjectTasks(serializeProjectTasks(defs)) equals the sanitized defs', () => {
    const defs: TaskDef[] = [
      t({ id: 'a', wasRunning: true, lastCommand: 'vim x', cwd: '/x', closeOnComplete: false }),
      t({ id: 'g', kind: 'agent', command: null, prompt: 'fix' })
    ];
    const sanitized: TaskDef[] = [
      t({ id: 'a', cwd: '/x', closeOnComplete: false }),
      t({ id: 'g', kind: 'agent', command: null, prompt: 'fix' })
    ];
    expect(parseProjectTasks(serializeProjectTasks(defs))).toEqual(sanitized);
  });
});

describe('project-terminals — Per-project config file', () => {
  it('round-trips autoWorktree true', () => {
    const cfg: ProjectConfig = { autoWorktree: true };
    expect(parseProjectConfig(serializeProjectConfig(cfg))).toEqual({ autoWorktree: true });
  });

  it('round-trips autoWorktree false', () => {
    const cfg: ProjectConfig = { autoWorktree: false };
    expect(parseProjectConfig(serializeProjectConfig(cfg))).toEqual({ autoWorktree: false });
  });

  it('round-trips autoWorktree absent (defaults off, omitted on disk)', () => {
    const env = JSON.parse(serializeProjectConfig({}));
    expect(env.version).toBe(PROJECT_CONFIG_VERSION);
    expect(env).not.toHaveProperty('autoWorktree');
    expect(parseProjectConfig(serializeProjectConfig({}))).toEqual({});
  });

  it('carries the version and only includes autoWorktree when boolean', () => {
    const env = JSON.parse(serializeProjectConfig({ autoWorktree: true }));
    expect(env.version).toBe(PROJECT_CONFIG_VERSION);
    expect(env.autoWorktree).toBe(true);
  });

  it('Absent config defaults off', () => {
    // An absent / unparseable config parses to {} (autoWorktree undefined ⇒ off).
    expect(parseProjectConfig(null)).toEqual({});
    expect(parseProjectConfig(undefined)).toEqual({});
    expect(parseProjectConfig('')).toEqual({});
    expect(parseProjectConfig('not json')).toEqual({});
    expect(parseProjectConfig('[]')).toEqual({});
    expect(parseProjectConfig('null')).toEqual({});
    // autoWorktree present but not a boolean ⇒ ignored.
    expect(parseProjectConfig('{"version":1,"autoWorktree":"yes"}')).toEqual({});
    // A config that simply omits autoWorktree leaves it undefined (treated false).
    expect(parseProjectConfig('{"version":1}').autoWorktree).toBeUndefined();
  });

  it('Auto-worktree read from config', () => {
    // A config envelope carrying autoWorktree:true reads back as true; false as
    // false; only a real boolean is honored.
    expect(parseProjectConfig('{"version":1,"autoWorktree":true}')).toEqual({ autoWorktree: true });
    expect(parseProjectConfig('{"version":1,"autoWorktree":false}')).toEqual({ autoWorktree: false });
    expect(parseProjectConfig('{"version":1}')).toEqual({});
  });
});
