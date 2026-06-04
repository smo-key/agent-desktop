#!/usr/bin/env node
// Agent-desktop EVENT HOOK — the single hook wired into every app-launched claude
// session, feeding the overview's event-sourced activity pipeline.
//
// It generalizes the old question-hook: instead of only surfacing a pending
// AskUserQuestion via a sidecar, it normalizes EVERY hook lifecycle event
// (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop,
// SubagentStop, SessionEnd) into one compact JSON event and delivers it over the
// app-hosted Unix-domain socket at $AGENT_DESKTOP_SOCKET_PATH.
//
// Why a socket (design D2): the app is what spawns claude, so it is always
// running when a hook fires; the socket gives the lowest-latency, ordered feed.
// The Rust side accepts the connection, parses the line, emits it to the
// frontend, buffers it, and appends it to a durable per-session sink.
//
// Contract with claude: this hook must NEVER block or slow a turn. It connects
// with a short timeout and SWALLOWS every error (missing/stale/closed socket,
// malformed stdin, fs/net failure), always exiting 0 with `{}` on stdout. A
// pending AskUserQuestion's structured payload rides on the PreToolUse event
// itself (it is not in the transcript until answered), replacing the sidecar.

'use strict';

const net = require('node:net');
const path = require('node:path');

/** Max ms to wait for the socket connect+write before giving up silently. */
const CONNECT_TIMEOUT_MS = 200;

/** Truncate a one-line string for a compact activity label. */
function clip(s, max) {
  const oneLine = String(s).replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/**
 * Build a short, human-readable activity label from a tool invocation, e.g.
 * `Bash:npm test`, `Edit:auth.ts`, `Task:code-review`, `mcp:slack/send`. Falls
 * back to the bare tool name for any shape it does not recognize, so a new or
 * unknown tool still yields a sensible label rather than nothing.
 */
function summarize(toolName, toolInput) {
  const name = typeof toolName === 'string' ? toolName : '';
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};

  // MCP tools are named `mcp__<server>__<tool>`; show `mcp:<server>/<tool>`.
  if (name.startsWith('mcp__')) {
    const parts = name.slice('mcp__'.length).split('__');
    const server = parts.shift() || '';
    const tool = parts.join('/');
    return tool ? `mcp:${server}/${tool}` : `mcp:${server}`;
  }

  switch (name) {
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      return cmd ? `Bash:${clip(cmd, 48)}` : 'Bash';
    }
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit': {
      const fp = typeof input.file_path === 'string' ? input.file_path : input.notebook_path;
      return typeof fp === 'string' && fp ? `${name}:${path.basename(fp)}` : name;
    }
    case 'Task': {
      const label = typeof input.subagent_type === 'string' && input.subagent_type
        ? input.subagent_type
        : typeof input.description === 'string'
          ? input.description
          : '';
      return label ? `Task:${clip(label, 40)}` : 'Task';
    }
    case 'Glob':
    case 'Grep': {
      const pat = typeof input.pattern === 'string' ? input.pattern : '';
      return pat ? `${name}:${clip(pat, 40)}` : name;
    }
    case 'WebFetch':
    case 'WebSearch': {
      const q = typeof input.url === 'string' ? input.url : input.query;
      return typeof q === 'string' && q ? `${name}:${clip(q, 40)}` : name;
    }
    default:
      return name || 'tool';
  }
}

/**
 * Extract the structured AskUserQuestion payload (header, prompt, multiSelect,
 * options) from a tool_input, mirroring the shape the overview renders. Returns
 * `null` when there are no well-formed questions.
 */
function extractQuestions(toolInput) {
  const raw = (toolInput && Array.isArray(toolInput.questions) && toolInput.questions) || [];
  const questions = raw
    .map((q) => {
      if (!q || typeof q.question !== 'string' || !q.question) return null;
      const options = Array.isArray(q.options)
        ? q.options
            .filter((o) => o && typeof o.label === 'string' && o.label)
            .map((o) => ({
              label: String(o.label),
              description: typeof o.description === 'string' ? o.description : ''
            }))
        : [];
      return {
        header: typeof q.header === 'string' ? q.header : '',
        question: String(q.question),
        multiSelect: q.multiSelect === true,
        options
      };
    })
    .filter(Boolean);
  return questions.length > 0 ? { questions } : null;
}

/**
 * Normalize a raw hook stdin object into the compact event the socket carries.
 * `paneId` comes from the env (the app stamps it at spawn); `nowMs` is the
 * receive timestamp. Always returns an object with at least
 * `{ paneId, sessionId, hookEventName, ts }`; tool/question/notification fields
 * are added only when the event carries them.
 */
function normalize(evt, paneId, nowMs) {
  const e = evt && typeof evt === 'object' ? evt : {};
  const out = {
    paneId: paneId || '',
    sessionId: typeof e.session_id === 'string' ? e.session_id : '',
    hookEventName: typeof e.hook_event_name === 'string' ? e.hook_event_name : '',
    ts: nowMs
  };

  const tool = typeof e.tool_name === 'string' ? e.tool_name : '';
  if ((out.hookEventName === 'PreToolUse' || out.hookEventName === 'PostToolUse') && tool) {
    out.toolName = tool;
    out.summary = summarize(tool, e.tool_input);
    if (out.hookEventName === 'PreToolUse' && tool === 'AskUserQuestion') {
      const q = extractQuestions(e.tool_input);
      if (q) out.question = q;
    }
  }

  if (out.hookEventName === 'Notification') {
    const msg = typeof e.message === 'string' ? e.message : '';
    if (msg) out.notification = msg;
  }

  return out;
}

/**
 * Deliver one event line to the socket and resolve when done (or on any failure).
 * Never rejects — a missing/stale/closed socket simply resolves so the caller
 * exits 0 and the turn is never blocked.
 */
function deliver(socketPath, line) {
  return new Promise((resolve) => {
    if (!socketPath) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    let sock;
    try {
      sock = net.createConnection({ path: socketPath });
    } catch (_) {
      return finish();
    }
    sock.setTimeout(CONNECT_TIMEOUT_MS);
    sock.on('connect', () => sock.end(line));
    sock.on('close', finish);
    sock.on('error', finish);
    sock.on('timeout', () => {
      try {
        sock.destroy();
      } catch (_) {
        /* ignore */
      }
      finish();
    });
  });
}

/** Read all of stdin into a string. */
function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', () => resolve(raw));
  });
}

async function main() {
  try {
    const raw = await readStdin();
    const evt = JSON.parse(raw || '{}');
    const paneId = process.env.AGENT_DESKTOP_PANE || '';
    const socketPath = process.env.AGENT_DESKTOP_SOCKET_PATH || '';
    const event = normalize(evt, paneId, Date.now());
    await deliver(socketPath, `${JSON.stringify(event)}\n`);
  } catch (_) {
    /* malformed stdin / net / fs error — never break the agent */
  }
  // Always succeed silently so the tool/turn is never blocked.
  process.stdout.write('{}');
}

if (require.main === module) {
  main();
}

module.exports = { summarize, extractQuestions, normalize };
