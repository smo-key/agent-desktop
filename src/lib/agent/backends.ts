// PURE agent-backend registry (`agent-backends` capability). One descriptor per
// supported agent CLI — everything the app must know that differs between
// `claude` and `copilot` lives HERE, so the rest of the codebase asks the
// registry ("is this an agent pane?", "does it support a statusline?", "what
// args resume session S?") instead of comparing against a hard-coded program
// name. Framework-free (no Svelte/Tauri imports) so the whole contract is
// unit-tested.
//
// Capability flags are the degradation mechanism (design D1): a feature gated
// on a flag the backend does not declare is OMITTED for that backend's panes —
// never rendered empty or broken.

import { genericModelLabel, modelLabel as claudeModelLabel } from '$lib/usage/modelLabel';

/** The agent CLIs the app can launch. */
export type AgentKind = 'claude' | 'copilot';

/** Every supported agent kind, in UI display order. */
export const AGENT_KINDS: readonly AgentKind[] = ['claude', 'copilot'];

/** The fallback backend when no setting/override says otherwise. */
export const DEFAULT_AGENT_KIND: AgentKind = 'claude';

/** What a backend can feed the app's observability/feature surfaces. */
export interface AgentCapabilities {
  /** Claude-style lifecycle hooks (event-hook.cjs pipeline). */
  hooks: boolean;
  /** Claude-style statusline command (statusline-wrapper.cjs pipeline). */
  statusline: boolean;
  /** Reports context-window usage (context % meter). */
  contextPct: boolean;
  /** Has a `~/.claude/tasks`-style tasks dir (task badges). */
  tasksDir: boolean;
  /** Subagent rows can be derived for this backend. */
  subagents: boolean;
  /** Specialists can be launched on this backend. */
  specialists: boolean;
  /** Pending questions can be ANSWERED by driving the TUI menu over the PTY.
   *  When false, activating a question alert focuses the pane instead. */
  askUserDriving: boolean;
}

/** Startup timing for initial-prompt delivery (see `launcher/initialInput.ts`). */
export interface ReadinessTiming {
  /** Output must be quiet this long (ms) before the prompt is delivered. */
  quietMs: number;
  /** Hard cap (ms) after the PTY is wired: deliver even if never quiet. */
  maxMs: number;
  /** Delay (ms) between writing the prompt text and the submitting Enter. */
  submitDelayMs: number;
}

/** Everything the app knows about one agent CLI. */
export interface AgentBackend {
  kind: AgentKind;
  /** Executable name on PATH — also the pane registry's `program` value. */
  program: string;
  /** Human name for settings/launcher UI. */
  displayName: string;
  /** Shown when the executable is not found on the resolved PATH. */
  installHint: string;
  /** Args that start a FRESH session under an app-minted UUID. */
  freshArgs(sessionId: string): string[];
  /** Args that RESUME the session previously started under `sessionId`. */
  resumeArgs(sessionId: string): string[];
  /** Args attaching an inline-JSON MCP server config to the launch. */
  mcpConfigArgs(configJson: string): string[];
  /** Format a backend-reported model id into a human label. */
  modelLabel(id: string | null, displayName: string | null): string;
  readiness: ReadinessTiming;
  /** Substrings in recent terminal text that mean "actively working"
   *  (fallback busy signal; matched case-insensitively). */
  busyMarkers: readonly string[];
  /** Regex busy patterns (dynamic-count affordances). */
  busyPatterns: readonly RegExp[];
  capabilities: AgentCapabilities;
}

/**
 * Copilot reports model ids from several families (`claude-sonnet-5`,
 * `gpt-5`, `o4-mini`, …). Claude-family ids reuse the claude formatter; other
 * ids get a readable generic transform: segments joined with spaces, known
 * acronym segments uppercased, others capitalized, pure-version segments kept
 * verbatim (`gpt-5` → `GPT 5`, `o4-mini` → `O4 Mini`). Unknown/empty falls
 * back to displayName, then em-dash — same contract as the claude formatter.
 */
export function copilotModelLabel(id: string | null, displayName: string | null): string {
  const fallback = displayName && displayName.length > 0 ? displayName : '—';
  if (!id || id.length === 0) return fallback;
  if (id.startsWith('claude-')) {
    return claudeModelLabel(id, displayName);
  }
  return genericModelLabel(id) ?? fallback;
}

/** Claude Code backend — the historical behavior, unchanged. */
const CLAUDE_BACKEND: AgentBackend = {
  kind: 'claude',
  program: 'claude',
  displayName: 'Claude Code',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  freshArgs: (sessionId) => ['--session-id', sessionId],
  resumeArgs: (sessionId) => ['--resume', sessionId],
  mcpConfigArgs: (configJson) => ['--mcp-config', configJson],
  modelLabel: claudeModelLabel,
  readiness: { quietMs: 700, maxMs: 8000, submitDelayMs: 400 },
  busyMarkers: ['esc to interrupt', 'ctrl+b to run in background'],
  busyPatterns: [/waiting for \d+ dynamic workflow/i],
  capabilities: {
    hooks: true,
    statusline: true,
    contextPct: true,
    tasksDir: true,
    subagents: true,
    specialists: true,
    askUserDriving: true
  }
};

/**
 * GitHub Copilot CLI backend (verified against 1.0.80, design S1–S4).
 * `--session-id <uuid>` sets the UUID for a NEW session (same contract as
 * claude); `--no-remote` keeps the session local (the analogue of claude's
 * `remoteControlAtStartup:false`). Observability comes from the
 * `~/.copilot/session-state/<uuid>/events.jsonl` tailer, not hooks — so
 * `busyMarkers` is deliberately EMPTY (copilot panes are always app-launched;
 * the events tailer is authoritative, and we don't guess unverified TUI
 * strings).
 */
const COPILOT_BACKEND: AgentBackend = {
  kind: 'copilot',
  program: 'copilot',
  displayName: 'GitHub Copilot',
  installHint: 'npm install -g @github/copilot',
  freshArgs: (sessionId) => ['--session-id', sessionId, '--no-remote'],
  resumeArgs: (sessionId) => ['--resume', sessionId, '--no-remote'],
  mcpConfigArgs: (configJson) => ['--additional-mcp-config', configJson],
  modelLabel: copilotModelLabel,
  readiness: { quietMs: 700, maxMs: 8000, submitDelayMs: 400 },
  busyMarkers: [],
  busyPatterns: [],
  capabilities: {
    hooks: false,
    statusline: false,
    contextPct: false,
    tasksDir: false,
    subagents: true,
    specialists: true,
    askUserDriving: false
  }
};

const BACKENDS: Record<AgentKind, AgentBackend> = {
  claude: CLAUDE_BACKEND,
  copilot: COPILOT_BACKEND
};

/** Look up a backend by kind. */
export function backendFor(kind: AgentKind): AgentBackend {
  return BACKENDS[kind];
}

/** Resolve a pane's `program` string to its backend, or null for non-agent
 *  panes (shells). Programs and kinds are the same strings by construction. */
export function backendForProgram(program: string | null | undefined): AgentBackend | null {
  if (program === 'claude' || program === 'copilot') return BACKENDS[program];
  return null;
}

/** Is this pane program a known agent CLI (vs a plain shell)? */
export function isAgentProgram(program: string | null | undefined): boolean {
  return backendForProgram(program) !== null;
}

/** PURE: normalize a persisted/unknown value to an AgentKind (default claude). */
export function parseAgentKind(raw: unknown): AgentKind {
  return raw === 'copilot' ? 'copilot' : DEFAULT_AGENT_KIND;
}
