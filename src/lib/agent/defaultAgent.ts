// PURE resolver for "which agent backend does a new session use by default?"
// (`agent-backends` capability). The settings store (`settings/agent.svelte.ts`)
// pushes the persisted preference in here; the launcher reads the resolved kind
// from here — so resolution stays framework-free and unit-tested, exactly like
// `$lib/shell/defaultShell`.

import { DEFAULT_AGENT_KIND, type AgentKind } from './backends';

let preference: AgentKind | null = null;

/** Set (or clear with null) the user's persisted agent preference. */
export function setAgentPreference(kind: AgentKind | null): void {
  preference = kind;
}

/** The agent kind a new session launches with, absent a per-session override. */
export function defaultAgentKind(): AgentKind {
  return preference ?? DEFAULT_AGENT_KIND;
}
