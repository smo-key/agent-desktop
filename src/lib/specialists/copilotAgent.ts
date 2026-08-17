// PURE translation of a SPECIALIST (a `.claude/agents/<name>.md` file) into a
// GitHub Copilot CUSTOM AGENT (`agent-specialists` / design S2). Copilot resolves
// `--agent <name>` against `~/.copilot/agents/<name>.agent.md` — a markdown file
// whose YAML frontmatter carries `name`/`description`/`model` and whose body is
// the persona (verified end-to-end on Copilot CLI 1.0.80).
//
// The app WRITES the generated file under an app-owned name prefix (so it never
// collides with the user's own custom agents) via the `copilot_install_agent`
// command, then launches with `--agent <generated-name>`.
//
// Deliberate narrowing (design S2 amendment): the specialist's `tools` list uses
// CLAUDE tool names (`Bash`, `Edit`, …) which do not exist in Copilot's tool
// vocabulary — mistranslating them could silently disable the whole agent, so
// tool scoping is NOT carried to copilot (persona + model are). Framework-free
// so the mapping is unit-tested.

import type { Specialist } from './specialists';

/** Prefix marking app-generated copilot agents (never the user's own). */
export const COPILOT_AGENT_PREFIX = 'agent-desktop-';

/**
 * The generated copilot agent name for specialist `name`: prefixed, lowercased,
 * and reduced to [a-z0-9-] so it is a safe filename component everywhere.
 * Returns null for a name with no usable characters.
 */
export function copilotAgentName(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `${COPILOT_AGENT_PREFIX}${slug}` : null;
}

/**
 * The generated `.agent.md` content for specialist `s`: YAML frontmatter
 * (name, description, model when present) + the persona body verbatim.
 */
export function copilotAgentFile(s: Specialist): string {
  const lines = ['---', `name: ${JSON.stringify(s.name)}`];
  const description =
    typeof s.description === 'string' && s.description.trim() !== ''
      ? s.description.trim()
      : `Agent Desktop specialist ${s.name}`;
  lines.push(`description: ${JSON.stringify(description)}`);
  if (typeof s.model === 'string' && s.model.trim() !== '') {
    lines.push(`model: ${JSON.stringify(s.model.trim())}`);
  }
  lines.push('---', '');
  const body = typeof s.prompt === 'string' ? s.prompt.trim() : '';
  return lines.join('\n') + (body ? body + '\n' : '');
}

/**
 * The copilot launch args applying an installed generated agent. Ready to
 * prepend to the pane's args (the spawn override owns `--session-id` etc.).
 */
export function copilotSpecialistArgs(agentName: string): string[] {
  return ['--agent', agentName];
}
