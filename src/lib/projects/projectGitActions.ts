// Push / Pull actions for a project, fired from its row's context menu in the
// project pane. Each shells out (via the Rust `git_push` / `git_pull` commands)
// against the project's FOLDER and surfaces git's own message non-blockingly via
// the toast store — success or failure — so the user gets feedback without a
// modal. Kept here (not in the Svelte component) so the wiring is unit-tested,
// mirroring `worktreePanel`.

import { invoke } from '@tauri-apps/api/core';
import { toast } from '../ui/toastStore.svelte';

/**
 * Opens an interactive terminal in project `projectId`'s folder that runs
 * `command` (e.g. `git push`). Injected by the app at startup (see `+page.svelte`)
 * so this module stays free of the tasks store / workspace imports — mirroring how
 * `projectTasks.setAgentLauncher` is wired. `null` until set (and in unit tests),
 * in which case a failed sync falls back to a toast.
 */
export type GitTerminalOpener = (projectId: string, command: string) => void;
let gitTerminalOpener: GitTerminalOpener | null = null;

/** Install (or clear, with `null`) the terminal opener used on a failed sync. */
export function setGitTerminalOpener(fn: GitTerminalOpener | null): void {
  gitTerminalOpener = fn;
}

/** Shorten git's multi-line stdout/stderr to a single tidy toast line. */
function oneLine(text: unknown): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  const first = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return first ?? '';
}

/**
 * Surface a failed sync. When a terminal opener is wired AND we know the project
 * id, open an interactive terminal in the project's folder running the failed git
 * command so the user sees git's full output and can act on it (authenticate,
 * resolve a conflict, retry). Otherwise fall back to a non-blocking failure toast
 * carrying git's own error.
 */
function surfaceFailure(
  projectId: string | null | undefined,
  command: string,
  name: string,
  verb: string,
  err: unknown
): void {
  if (projectId && gitTerminalOpener) {
    gitTerminalOpener(projectId, command);
    return;
  }
  toast.show(`${verb} failed for "${name}": ${oneLine(err)}`);
}

/**
 * Push the project's current branch to its remote via `git_push`. On success a
 * toast confirms (echoing git's message, e.g. "Everything up-to-date"); on
 * failure it opens an interactive terminal in the folder running `git push` (so
 * the user can see the error and act), falling back to a failure toast when no
 * terminal surface is wired. A project with no folder warns instead of invoking.
 * `projectId` is needed to open the terminal in the right project's panel.
 */
export async function pushProject(
  path: string | null | undefined,
  name: string,
  projectId?: string | null
): Promise<void> {
  if (!path) {
    toast.show(`"${name}" has no folder to push.`);
    return;
  }
  try {
    const out = await invoke<string>('git_push', { repoPath: path });
    const detail = oneLine(out);
    toast.show(detail ? `Pushed "${name}" — ${detail}` : `Pushed "${name}".`);
  } catch (err) {
    surfaceFailure(projectId, 'git push', name, 'Push', err);
  }
}

/**
 * Pull the project's current branch from its remote via `git_pull`. On success a
 * toast confirms (echoing git's message); on failure it opens an interactive
 * terminal in the folder running `git pull` (so the user can see the error and
 * act), falling back to a failure toast when no terminal surface is wired. A
 * project with no folder warns instead of invoking. `projectId` is needed to open
 * the terminal in the right project's panel.
 */
export async function pullProject(
  path: string | null | undefined,
  name: string,
  projectId?: string | null
): Promise<void> {
  if (!path) {
    toast.show(`"${name}" has no folder to pull.`);
    return;
  }
  try {
    const out = await invoke<string>('git_pull', { repoPath: path });
    const detail = oneLine(out);
    toast.show(detail ? `Pulled "${name}" — ${detail}` : `Pulled "${name}".`);
  } catch (err) {
    surfaceFailure(projectId, 'git pull', name, 'Pull', err);
  }
}
