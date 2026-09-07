// Event-hook tests (add-activity-event-pipeline, tasks 1.1–1.5).
//
// Two layers:
//  - PURE core (summarize / normalize / extractQuestions) required directly from
//    the production .cjs and asserted in-process.
//  - INTEGRATION: the real hook run as a subprocess (its `require.main` path),
//    delivering over a real Unix socket, and the no-block guarantee when no
//    socket is listening.
//
// Test titles map to the `#### Scenario:` names in
// openspec/changes/add-activity-event-pipeline/specs/activity-events/spec.md
// (the coverage gate normalizes both to snake_case).

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'event-hook.cjs');
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('./event-hook.cjs') as typeof import('./event-hook.cjs');

const PANE_ID = 'pane-evt-uuid-0001';

// A platform-appropriate IPC endpoint for the event socket. The hook transport
// is path-opaque (`net.createConnection({ path })`), but the SERVER side differs
// by OS: Windows cannot bind a Unix-domain socket to a filesystem path (Node
// errors with EACCES), so it requires a named pipe `\\.\pipe\<name>`. Use a pipe
// on Windows and a Unix-socket file under `tmp` elsewhere; both `server.listen`
// and the hook's `createConnection` accept either form, so the SAME delivery
// path is exercised on every OS. Pipe names are made unique per call (pid + seq)
// to avoid collisions across tests in the same process.
let pipeSeq = 0;
function ipcEndpoint(name: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\agentdesk-evt-${process.pid}-${pipeSeq++}-${name}`;
  }
  return join(tmp, name);
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agentdesk-evt-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('event-hook pure core', () => {
  it('Tool event summarized', () => {
    expect(hook.summarize('Bash', { command: 'npm test' })).toBe('Bash:npm test');
    expect(hook.summarize('Edit', { file_path: '/a/b/auth.ts' })).toBe('Edit:auth.ts');
    expect(hook.summarize('Read', { file_path: '/a/b/c.md' })).toBe('Read:c.md');
    expect(hook.summarize('Task', { subagent_type: 'code-review' })).toBe('Task:code-review');
    expect(hook.summarize('mcp__slack__send_message', {})).toBe('mcp:slack/send_message');
    // Unknown shape falls back to the bare tool name.
    expect(hook.summarize('SomeFutureTool', { whatever: 1 })).toBe('SomeFutureTool');
  });

  it('Pending question carried on the event', () => {
    const evt = {
      session_id: 'sess-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          {
            header: 'Approach',
            question: 'Which one?',
            multiSelect: false,
            options: [{ label: 'A', description: 'first' }, { label: 'B', description: '' }]
          }
        ]
      }
    };
    const out = hook.normalize(evt, PANE_ID, 1000);
    expect(out.paneId).toBe(PANE_ID);
    expect(out.sessionId).toBe('sess-1');
    expect(out.hookEventName).toBe('PreToolUse');
    expect(out.toolName).toBe('AskUserQuestion');
    expect(out.question).toEqual({
      questions: [
        {
          header: 'Approach',
          question: 'Which one?',
          multiSelect: false,
          options: [{ label: 'A', description: 'first' }, { label: 'B', description: '' }]
        }
      ]
    });
    // A non-question tool carries a summary but no question payload.
    const other = hook.normalize(
      { session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
      PANE_ID,
      2000
    );
    expect(other.question).toBeUndefined();
    expect(other.summary).toBe('Bash:ls');
    expect(other.ts).toBe(2000);
  });

  it('Session-end reason carried on the event', () => {
    // The SessionEnd hook input carries a `reason` (clear / logout / prompt_input_exit /
    // other); forward it so the overview can tell a `/clear` (process continues) from a
    // real end and not auto-archive the live session.
    const ended = hook.normalize(
      { session_id: 's', hook_event_name: 'SessionEnd', reason: 'clear' },
      PANE_ID,
      3000
    );
    expect(ended.hookEventName).toBe('SessionEnd');
    expect(ended.reason).toBe('clear');

    // A non-SessionEnd event carries no reason.
    const stop = hook.normalize({ session_id: 's', hook_event_name: 'Stop' }, PANE_ID, 3000);
    expect(stop.reason).toBeUndefined();
  });
});

describe('event-hook delivery', () => {
  it('Event delivered as one line', async () => {
    const socketPath = ipcEndpoint('events.sock');
    const received: string[] = [];
    const server = createServer((conn) => {
      let buf = '';
      conn.on('data', (d) => {
        buf += d.toString();
      });
      conn.on('end', () => received.push(buf));
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const payload = JSON.stringify({
      session_id: 'sess-9',
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/repo/src/main.rs' }
    });

    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [HOOK], {
        env: { ...process.env, AGENT_DESKTOP_PANE: PANE_ID, AGENT_DESKTOP_SOCKET_PATH: socketPath }
      });
      child.stdin.end(payload);
      child.on('close', () => setTimeout(resolve, 50));
    });

    server.close();
    expect(received).toHaveLength(1);
    // Exactly one newline-terminated JSON line.
    expect(received[0].endsWith('\n')).toBe(true);
    expect(received[0].trimEnd().split('\n')).toHaveLength(1);
    const evt = JSON.parse(received[0]);
    expect(evt).toMatchObject({
      paneId: PANE_ID,
      sessionId: 'sess-9',
      hookEventName: 'PreToolUse',
      toolName: 'Edit',
      summary: 'Edit:main.rs'
    });
    expect(typeof evt.ts).toBe('number');
  });

  it('Socket absent does not block the turn', () => {
    // No server listening at this path — the hook must still exit 0 quickly.
    const socketPath = ipcEndpoint('nobody-home.sock');
    const res = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, AGENT_DESKTOP_PANE: PANE_ID, AGENT_DESKTOP_SOCKET_PATH: socketPath }
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('{}');
  });

  it('An absent socket does not block a turn', () => {
    // The no-block guarantee must hold on EVERY platform and for every way the
    // address can be unusable — the address form differs by OS (socket file vs
    // named pipe), and on Windows an unset/garbage value is a likelier failure
    // mode than on Unix. A hook that hangs here would stall the agent's turn.
    const unusable = [
      ipcEndpoint('never-bound.sock'), // well-formed for this OS, nothing listening
      '', // env var unset entirely
      process.platform === 'win32'
        ? 'C:\\does\\not\\exist\\events.sock' // a path, not a pipe: unbindable on Windows
        : '/does/not/exist/events.sock'
    ];

    for (const socketPath of unusable) {
      const started = Date.now();
      const res = spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, AGENT_DESKTOP_PANE: PANE_ID, AGENT_DESKTOP_SOCKET_PATH: socketPath }
      });
      // Exits cleanly with the empty hook response, so claude proceeds.
      expect(res.status, `address ${JSON.stringify(socketPath)} did not exit 0`).toBe(0);
      expect(res.stdout).toBe('{}');
      // And promptly — not merely eventually via the spawn timeout.
      expect(Date.now() - started).toBeLessThan(5000);
    }
  });
});
