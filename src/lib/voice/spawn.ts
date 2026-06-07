// Spawn a NEW agent seeded with dictated text, for when there is no existing agent
// to receive it ("if there is no selected agent, spin up a new agent"). Thin,
// untested wrapper over the shared launch path (`workspace.launch` +
// `buildLaunchPlan`) — the same one the inbox "+" / ⌘N use — so a voice-spawned
// agent behaves identically to any other new session.
//
// The dictated text is passed as the plan's `initialInput`, so the standard
// TerminalPane delivery (wait for the PTY to settle, then write the text verbatim)
// seeds the fresh agent — no PTY race. Note: a brand-new agent's initial prompt IS
// submitted (that's how a session is started from a prompt); the no-auto-submit
// rule applies to inserting into an ALREADY-RUNNING agent.

import { workspace } from '../layout/workspace.svelte';
import { buildLaunchPlan } from '../launcher/plan';
import { projects } from '../projects/projects.svelte';
import { projectForId } from '../projects/projects';
import { projectFilter } from '../projects/projectFilter.svelte';

/**
 * Launch a new agent session seeded with `text`. Uses the filtered project when a
 * concrete one is selected, otherwise the most-recent project. Returns `true` when
 * an agent was launched, `false` when there is no project to launch into (the
 * caller then surfaces a "no agent / no project" message).
 */
export function spawnAgentWithDictation(text: string): boolean {
  const proj = projectForId(projects.list, projectFilter.selected) ?? projects.list[0] ?? null;
  if (!proj) return false;
  workspace.launch(
    buildLaunchPlan({ folder: proj.path, prompt: text, placement: 'tab', projectId: proj.id })
  );
  return true;
}
