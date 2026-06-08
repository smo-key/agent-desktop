// Push / Pull actions for a project, fired from its row's context menu in the
// project pane. Each shells out (via the Rust `git_push` / `git_pull` commands)
// against the project's FOLDER and surfaces git's own message non-blockingly via
// the toast store — success or failure — so the user gets feedback without a
// modal. Kept here (not in the Svelte component) so the wiring is unit-tested,
// mirroring `worktreePanel`.

import { invoke } from '@tauri-apps/api/core';
import { toast } from '../ui/toastStore.svelte';

/** Shorten git's multi-line stdout/stderr to a single tidy toast line. */
function oneLine(text: unknown): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  const first = s.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return first ?? '';
}

/**
 * Push the project's current branch to its remote via `git_push`. On success a
 * toast confirms (echoing git's message, e.g. "Everything up-to-date"); on
 * failure the toast carries git's error (no upstream / rejected / offline). A
 * project with no folder warns instead of invoking.
 */
export async function pushProject(path: string | null | undefined, name: string): Promise<void> {
  if (!path) {
    toast.show(`"${name}" has no folder to push.`);
    return;
  }
  try {
    const out = await invoke<string>('git_push', { repoPath: path });
    const detail = oneLine(out);
    toast.show(detail ? `Pushed "${name}" — ${detail}` : `Pushed "${name}".`);
  } catch (err) {
    toast.show(`Push failed for "${name}": ${oneLine(err)}`);
  }
}

/**
 * Pull the project's current branch from its remote via `git_pull`. On success a
 * toast confirms (echoing git's message); on failure the toast carries git's
 * error (conflict / no upstream / offline). A project with no folder warns
 * instead of invoking.
 */
export async function pullProject(path: string | null | undefined, name: string): Promise<void> {
  if (!path) {
    toast.show(`"${name}" has no folder to pull.`);
    return;
  }
  try {
    const out = await invoke<string>('git_pull', { repoPath: path });
    const detail = oneLine(out);
    toast.show(detail ? `Pulled "${name}" — ${detail}` : `Pulled "${name}".`);
  } catch (err) {
    toast.show(`Pull failed for "${name}": ${oneLine(err)}`);
  }
}
