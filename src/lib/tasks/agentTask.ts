// PURE helper for the "auto-archive a task-spawned agent" behavior (project-tasks
// spec — "Agent task launch"). An agent task opens a fire-and-forget Claude
// session; once it FINISHES the turn it was launched for and returns to the user,
// the route archives it. This module isolates the decision so it is unit-tested
// without the live event store / workspace.

/**
 * Whether a task-spawned agent session has RETURNED TO THE USER and should be
 * archived. True when the session is at the prompt awaiting the user
 * (event status `waiting` or `finished`) AND it has actually started its turn —
 * i.e. a `UserPromptSubmit` is already in its timeline. The timeline guard
 * distinguishes the post-work "done" `waiting` from the fresh-session idle
 * `waiting` (a just-launched session that hasn't submitted its prompt yet), so we
 * never archive an agent before it has done anything.
 */
export function taskAgentReturnedToUser(
  status: string | null | undefined,
  timeline: ReadonlyArray<{ hookEventName: string }>
): boolean {
  if (status !== 'waiting' && status !== 'finished') return false;
  return timeline.some((e) => e.hookEventName === 'UserPromptSubmit');
}
