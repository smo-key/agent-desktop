// PURE resolution of which executable an agent pane actually spawns
// (`wsl-agent-launch`). Framework-free (no Svelte/Tauri imports) so the
// resolution order — the thing that decides what gets executed — is unit-tested
// without a live backend.
//
// The order is: the user's explicit preference, then what detection found, then
// the backend's bare program name (today's behavior, and the reason a failed
// probe can never block a launch).

import { AGENT_KINDS, backendFor, type AgentKind } from '$lib/agent/backends';

/** Per-agent executable preference. An empty value means "use the detected one". */
export type AgentPaths = Record<AgentKind, string>;

/** Per-agent detection result. `null` means "not found / not probed". */
export type DetectedAgentPaths = Partial<Record<AgentKind, string | null>>;

/** Fresh install: no explicit choice, so detection (else the bare name) applies. */
export function defaultAgentPaths(): AgentPaths {
  return Object.fromEntries(AGENT_KINDS.map((k) => [k, ''])) as AgentPaths;
}

/**
 * PURE: validate/normalize the persisted `agentPaths` slice. Tolerates any shape
 * — non-objects, missing keys, wrong types and unknown keys all collapse to
 * "unset" rather than reaching a spawn.
 */
export function parseAgentPaths(raw: unknown): AgentPaths {
  const out = defaultAgentPaths();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const kind of AGENT_KINDS) {
    const value = obj[kind];
    if (typeof value === 'string' && value.trim()) out[kind] = value.trim();
  }
  return out;
}

/**
 * The executable to spawn for `kind`.
 *
 * Falls through preference → detected → the backend's bare program name. That
 * last step is what makes detection ADVISORY: when the probe found nothing (or
 * never ran), the launch proceeds exactly as it does today rather than failing
 * on an empty command.
 */
export function resolveAgentExecutable(
  kind: AgentKind,
  prefs: AgentPaths | null | undefined,
  detected: DetectedAgentPaths | null | undefined
): string {
  const pref = prefs?.[kind];
  if (typeof pref === 'string' && pref.trim()) return pref.trim();
  const found = detected?.[kind];
  if (typeof found === 'string' && found.trim()) return found.trim();
  return backendFor(kind).program;
}

/**
 * What the settings input shows as its placeholder: the detected executable, or
 * the bare program name when nothing was detected — i.e. exactly what would be
 * spawned if the user left the field empty, which is the point of showing it.
 */
export function placeholderFor(
  kind: AgentKind,
  detected: DetectedAgentPaths | null | undefined
): string {
  return resolveAgentExecutable(kind, null, detected);
}
