// Push / Pull actions for a project, fired from its row's context menu in the
// project pane. Each shells out (via the Rust `git_push` / `git_pull` commands)
// against the project's FOLDER and surfaces git's own message non-blockingly via
// the toast store — success or failure — so the user gets feedback without a
// modal. Kept here (not in the Svelte component) so the wiring is unit-tested,
// mirroring `worktreePanel`.

import { invoke } from '@tauri-apps/api/core';
import { toast } from '../ui/toastStore.svelte';
import { gitBusy } from './projectGitBusy.svelte';

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
export function oneLine(text: unknown): string {
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
export function surfaceFailure(
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
  // Guard against a double-trigger: a push/pull is already running in this folder.
  if (gitBusy.isBusy(path)) return;
  gitBusy.begin(path);
  try {
    const out = await invoke<string>('git_push', { repoPath: path });
    const detail = oneLine(out);
    toast.show(detail ? `Pushed "${name}" — ${detail}` : `Pushed "${name}".`);
  } catch (err) {
    surfaceFailure(projectId, 'git push', name, 'Push', err);
  } finally {
    gitBusy.end(path);
  }
}

/** One commit record returned by the `commits_to_push` Tauri command. */
export interface PushCommit {
  hash: string;
  subject: string;
}

/**
 * Return the commits that a `git push` would send for `repoPath` — i.e. commits
 * on HEAD not yet on the upstream tracking branch. Best-effort: no upstream /
 * off-repo / backend error → empty array. Never throws.
 */
export async function commitsToPush(repoPath: string | null | undefined): Promise<PushCommit[]> {
  if (!repoPath) return [];
  try {
    return await invoke<PushCommit[]>('commits_to_push', { repoPath });
  } catch {
    return [];
  }
}

/**
 * Resolve the repo's BASE web (GitHub) URL for `repoPath` via `repo_web_url`
 * (which shells out to `gh repo view --json url`), e.g. `https://github.com/o/r`.
 * Best-effort: no repo path / not on GitHub / gh missing-or-unauthenticated /
 * backend error → `null`. Never throws. The push popover uses it to build each
 * commit's diff-view link; `null` keeps the commit rows inert.
 */
export async function repoWebUrl(repoPath: string | null | undefined): Promise<string | null> {
  if (!repoPath) return null;
  try {
    return (await invoke<string | null>('repo_web_url', { repoPath })) ?? null;
  } catch {
    return null;
  }
}

/**
 * PURE: build a commit's GitHub diff-view URL (`<base>/commit/<hash>`) from the
 * repo's base web URL and a commit hash. Returns `null` when either is missing —
 * so a non-GitHub repo (no `base`) yields no link and the commit row stays inert.
 * A trailing slash on `base` is tolerated (the backend already strips it, but the
 * builder guards anyway so a stray slash can't produce `//commit`).
 */
export function commitWebUrl(
  base: string | null | undefined,
  hash: string | null | undefined
): string | null {
  if (!base || !hash) return null;
  return `${base.replace(/\/+$/, '')}/commit/${hash}`;
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
  // Guard against a double-trigger: a push/pull is already running in this folder.
  if (gitBusy.isBusy(path)) return;
  gitBusy.begin(path);
  try {
    const out = await invoke<string>('git_pull', { repoPath: path });
    const detail = oneLine(out);
    toast.show(detail ? `Pulled "${name}" — ${detail}` : `Pulled "${name}".`);
  } catch (err) {
    surfaceFailure(projectId, 'git pull', name, 'Pull', err);
  } finally {
    gitBusy.end(path);
  }
}
