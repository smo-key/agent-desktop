// Branch listing, switching, and creation actions for a project. Each shells
// out via Rust commands against the project's folder and surfaces git's own
// message non-blockingly via the toast store. Mirrors `projectGitActions.ts`
// in structure — same invoke/toast/gitBusy imports, same surfaceFailure helper
// (re-used from that module to share the single terminal opener registration).

import { invoke } from '@tauri-apps/api/core';
import { toast } from '../ui/toastStore.svelte';
import { gitBusy } from './projectGitBusy.svelte';
import { oneLine, surfaceFailure } from './projectGitActions';

/**
 * The shape returned by the Rust `git_list_branches` command.
 * `current` is null when HEAD is detached or the branch cannot be determined.
 */
export interface BranchList {
  current: string | null;
  local: string[];
  remotes: string[];
}

/**
 * Silently query the branch list for `path`. Returns an empty list when the
 * path is falsy or the Rust command throws (e.g. not a git repo). No toast,
 * no busy guard — pure read.
 */
export async function listBranches(path: string | null | undefined): Promise<BranchList> {
  if (!path) return { current: null, local: [], remotes: [] };
  try {
    return await invoke<BranchList>('git_list_branches', { repoPath: path });
  } catch {
    return { current: null, local: [], remotes: [] };
  }
}

/**
 * Switch `path`'s working tree to `branch` via `git_checkout`. On success a
 * toast confirms and `onDone` is called. On failure the failure is surfaced
 * (terminal or toast). A project with no folder warns instead of invoking.
 */
export async function switchBranch(
  path: string | null | undefined,
  branch: string,
  name: string,
  projectId?: string | null,
  onDone?: () => void
): Promise<void> {
  if (!path) {
    toast.show(`"${name}" has no folder.`);
    return;
  }
  if (gitBusy.isBusy(path)) return;
  gitBusy.begin(path);
  try {
    const out = await invoke<string>('git_checkout', { repoPath: path, branch });
    const detail = oneLine(out);
    toast.show(detail ? `Switched "${name}" to ${branch} — ${detail}` : `Switched "${name}" to ${branch}.`);
    onDone?.();
  } catch (err) {
    surfaceFailure(projectId, `git checkout ${branch}`, name, 'Switch', err);
  } finally {
    gitBusy.end(path);
  }
}

/**
 * Create a new branch `name` in `path`'s repo via `git_create_branch`. On
 * success a toast confirms and `onDone` is called. On failure the failure is
 * surfaced (terminal or toast). A project with no folder warns instead of
 * invoking.
 */
export async function createBranch(
  path: string | null | undefined,
  name: string,
  projectName: string,
  projectId?: string | null,
  onDone?: () => void
): Promise<void> {
  if (!path) {
    toast.show(`"${projectName}" has no folder.`);
    return;
  }
  if (gitBusy.isBusy(path)) return;
  gitBusy.begin(path);
  try {
    const out = await invoke<string>('git_create_branch', { repoPath: path, name });
    const detail = oneLine(out);
    toast.show(detail ? `Created ${name} on "${projectName}" — ${detail}` : `Created ${name} on "${projectName}".`);
    onDone?.();
  } catch (err) {
    surfaceFailure(projectId, `git checkout -b ${name}`, projectName, 'Create branch', err);
  } finally {
    gitBusy.end(path);
  }
}

/**
 * Strip ONLY the first path segment (the remote name) from a remote-tracking
 * ref, preserving any further segments. Examples:
 *   `origin/feature-x`   → `feature-x`
 *   `origin/feature/x`   → `feature/x`
 *   `main` (no slash)    → `main`
 */
export function remoteShortName(ref: string): string {
  const slash = ref.indexOf('/');
  return slash === -1 ? ref : ref.slice(slash + 1);
}

/**
 * Case-insensitive substring filter over `branches`. An empty or whitespace-
 * only `query` returns the list unchanged.
 */
export function filterBranches(branches: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return branches;
  return branches.filter((b) => b.toLowerCase().includes(q));
}
