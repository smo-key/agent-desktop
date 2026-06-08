// PURE, framework-free building blocks for the per-project COORDINATOR (add-agent-
// specialists, tasks 6.1–6.4). No Svelte/Tauri/DOM imports, so the load-bearing
// bits — the orchestrator system prompt, the single-coordinator reuse lookup, and
// the coordinator's `claude` launch-args composition — are unit-tested without a
// live workspace or PTY.
//
// A coordinator is ONE `claude` pane per project, launched with:
//   (a) the orchestration MCP toolkit (`--mcp-config <json>`, from
//       `buildMcpToolkitConfig`), and
//   (b) the orchestrator system prompt (`--append-system-prompt <prompt>`),
// so the session can dynamically spawn/coordinate specialists and existing project
// sessions via the already-built toolkit. The launch goes through `workspace.launch`
// with `role:'coordinator'` and these flags as its `extraArgs`.

import type { McpToolkitConfig } from '../usage/spawn';

/**
 * The ORCHESTRATOR system prompt (task 6.4). Appended to Claude Code's default
 * prompt (`--append-system-prompt`) for the coordinator pane only. Deliberately
 * FOCUSED + PRACTICAL: take a goal, plan, and spawn/coordinate agents via the
 * toolkit. Explicitly NO governance/guardrails — that is a separate future change,
 * so this prompt must not invent approval gates, policy checks, or veto rules.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the COORDINATOR for this project — an orchestrator of other Claude Code agents.

Your job: take a goal from the user, break it into a concrete plan, then spawn and coordinate specialist agents and existing project sessions to carry it out. You drive the work entirely through the orchestration toolkit (tools prefixed \`mcp__orchestration__\`).

You do NOT do work yourself. Do not edit files, run commands, or complete tasks directly — you cannot, and you must not try. You have no Task tool; never attempt to use it. Every goal MUST be accomplished by creating sessions with \`spawn_agent\` (optionally naming a \`specialist\`) and coordinating them with the toolkit (\`message_agent\`, \`read_agent\`, \`inspect_agent\`, \`list_agents\`, \`archive_agent\`). Read-only inspection (Read/Glob/Grep) is available for understanding the project before you delegate, but the actual work always belongs to the agents you spawn.

Available toolkit:
- \`list_agents\` — see every agent in this project (coordinator-spawned and user-started), with status.
- \`inspect_agent\` / \`read_agent\` — check one agent's identity, status, and recent output.
- \`spawn_agent({ prompt, specialist?, cwd? })\` — launch a new agent with a goal; pass a \`specialist\` name to give it a persona (\`.claude/agents/<name>.md\`).
- \`message_agent({ paneId, text })\` — send instructions/feedback to a running agent (delivered when it is idle).
- \`archive_agent\` / \`unarchive_agent\` — close out or reopen an agent.
- \`request_user_input({ message? })\` — NOTIFY the user that you need them (see below).

Getting the user's attention: you will NOT be flagged as "needs input" just for being idle — you are expected to keep planning, spawning, and coordinating. When you genuinely need a decision or answer from the user and you are NOT already asking via the AskUserQuestion tool, you MUST call \`request_user_input\` (it surfaces as \`mcp__orchestration__request_user_input\`, with a short \`message\` describing what you need) so the user is actually notified. If you are asking a multiple-choice question, prefer the AskUserQuestion tool instead. Otherwise, do not sit idle waiting for attention — keep working and delegating.

How to work:
1. Restate the goal and outline a short plan (which agents/specialists, in what order, what each owns).
2. Spawn agents for parallelizable work; give each a clear, self-contained brief.
3. Poll their status with \`list_agents\`/\`read_agent\`; relay results between them and integrate.
4. When an agent finishes or stalls, message it with next steps or archive it.
5. Report progress and the final outcome back to the user.

Stay scoped to THIS project — every toolkit call is automatically bound to it. Be decisive and concrete: spawn real agents rather than describing what you would do, and never substitute your own hands-on work for delegation. You have no approval/guardrail responsibilities; just plan, delegate, and integrate.`;

/** Spawn parameters the reuse lookup needs from a pane (framework-free shape). */
export interface CoordinatorPaneView {
  /** The pane's id. */
  paneId: string;
  /** The program the pane runs (only `claude` panes can be coordinators). */
  program: string;
  /** The project the pane was launched under, or null/undefined. */
  projectId?: string | null;
  /** The pane's role marker (`'coordinator'` for a coordinator pane). */
  role?: 'coordinator';
  /** Whether the pane's session is closed (archived) — a closed coordinator does
   *  not count as the live one (a new "Start coordinator" relaunches/restores it). */
  closed?: boolean;
}

/**
 * PURE: find the LIVE coordinator pane for `projectId`, or null. A pane qualifies
 * when it is a `claude` pane, marked `role:'coordinator'`, belongs to `projectId`,
 * and is not closed. The FIRST match in iteration order wins (the invariant is one
 * coordinator per project, but we never throw if state momentarily has two). Used by
 * the single-coordinator gate (task 6.3) to reuse/focus instead of launching another.
 *
 * @param panes      every pane across all workspaces (the caller flattens the registry).
 * @param projectId  the project to find the coordinator for.
 */
export function findCoordinatorPane(
  panes: ReadonlyArray<CoordinatorPaneView>,
  projectId: string
): CoordinatorPaneView | null {
  if (typeof projectId !== 'string' || projectId.trim() === '') return null;
  for (const p of panes) {
    if (
      p.program === 'claude' &&
      p.role === 'coordinator' &&
      (p.projectId ?? null) === projectId &&
      p.closed !== true
    ) {
      return p;
    }
  }
  return null;
}

/**
 * PURE: compose the coordinator's extra `claude` CLI args (task 6.2). Ready to pass
 * as the launch plan's `extraArgs` (PREPENDED before the spawn override's own
 * `--session-id` / `--settings`):
 *   - `--append-system-prompt <orchestrator prompt>` — the coordinator persona.
 *   - `--mcp-config <inline JSON>` — attaches the orchestration toolkit (inline JSON
 *     string, the simplest form claude accepts; no temp file needed). The config
 *     already carries the coordinator's own projectId in its server env so every
 *     toolkit call is project-scoped.
 *   - `--disallowedTools Edit Write Bash NotebookEdit Task` — the coordinator must NOT
 *     do work itself (task 10.1): the hands-on/work tools and the internal Task tool
 *     are denied (each tool a separate arg, claude's variadic flag), forcing it to
 *     delegate via `spawn_agent` and coordinate through the toolkit. The orchestration
 *     MCP tools (`mcp__orchestration__*`) and read-only inspection (Read/Glob/Grep)
 *     are deliberately left ALLOWED.
 *
 * Pure: depends only on its inputs; never mutates them.
 *
 * @param mcpConfig  the toolkit config from `buildMcpToolkitConfig(adapter, socket, projectId)`.
 * @param systemPrompt  the orchestrator prompt (defaults to {@link ORCHESTRATOR_SYSTEM_PROMPT}).
 */
export function coordinatorLaunchArgs(
  mcpConfig: McpToolkitConfig,
  systemPrompt: string = ORCHESTRATOR_SYSTEM_PROMPT
): string[] {
  return [
    '--append-system-prompt',
    systemPrompt,
    '--mcp-config',
    JSON.stringify(mcpConfig),
    // Work tools + internal Task tool denied — the coordinator only orchestrates.
    '--disallowedTools',
    'Edit',
    'Write',
    'Bash',
    'NotebookEdit',
    'Task'
  ];
}
