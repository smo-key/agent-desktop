// PURE helpers that turn the workspace registries into the pane / session refs
// the pollers and watchers read. The distinction they enforce (performance):
//
// - ALL agent panes (`allAgentPaneRefs`) — for one-shot, in-memory work such as
//   seeding cached titles at restore.
// - LIVE agent panes only (`liveAgentPaneRefs`) — for anything that costs IO per
//   pane on a clock (transcript reads, event re-seeds, title generation, the
//   subagents watched-set). A CLOSED (archived) agent has no running process and
//   no changing transcript, so polling it is pure waste that grows with every
//   session ever closed. Restoring / previewing an archived agent clears `closed`
//   (see `WorkspaceStore.restore` / `preview`), so it rejoins the live set at once.

import { isAgentProgram } from '$lib/agent/backends';
import { sessionCwd, type PaneSession, type WorkspaceEntry } from '$lib/layout/workspace.svelte';
import type { PaneRef } from './activity.svelte';

/** A pane is LIVE when it is not closed (archived). Pure. */
export function isLivePane(session: Pick<PaneSession, 'closed'> | null | undefined): boolean {
  return !!session && !session.closed;
}

function agentRef(paneId: string, sess: PaneSession): PaneRef | null {
  if (!isAgentProgram(sess.program) || !sess.sessionId) return null;
  return { paneId, sessionId: sess.sessionId, cwd: sessionCwd(sess), program: sess.program };
}

/** Every agent pane with a session id, closed or not (registry order). */
export function allAgentPaneRefs(workspaces: ReadonlyArray<WorkspaceEntry>): PaneRef[] {
  const refs: PaneRef[] = [];
  for (const ws of workspaces) {
    for (const [paneId, sess] of Object.entries(ws.registry)) {
      const ref = agentRef(paneId, sess);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

/** Only the LIVE (not closed) agent panes — the set every clocked poller reads. */
export function liveAgentPaneRefs(workspaces: ReadonlyArray<WorkspaceEntry>): PaneRef[] {
  const refs: PaneRef[] = [];
  for (const ws of workspaces) {
    for (const [paneId, sess] of Object.entries(ws.registry)) {
      if (!isLivePane(sess)) continue;
      const ref = agentRef(paneId, sess);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}
