// Thin frontend wrapper over the Rust `worktree_create` command. Used by the
// launch flow when a project has `autoWorktree`: it creates a fresh git worktree
// off the repo's HEAD and returns its path/branch/base so the session can launch
// in the worktree instead of the project folder.
//
// Tolerant by design: ANY failure (not a git repo, git error, non-Tauri context)
// resolves to `null` — never throws — so the caller can fall back to the project
// path with a non-blocking warning. The pure, unit-tested contract (resolve→obj /
// reject→null) lives in `worktree.test.ts` with `invoke` mocked.

import { invoke } from '@tauri-apps/api/core';

/** The successful outcome of `worktree_create` (mirrors the Rust struct). */
export interface CreatedWorktree {
  /** Absolute path of the new worktree (`<repo>/.worktrees/<branch>`). */
  path: string;
  /** The fresh `session/...` branch the worktree is checked out on. */
  branch: string;
  /** The base commit SHA (HEAD at creation) the branch forked from. */
  base: string;
}

/**
 * Create a git worktree off `repoPath`'s HEAD via the Rust `worktree_create`
 * command. Returns the created worktree on success, or `null` on ANY error
 * (caught) — callers fall back to the project path.
 */
export async function createWorktree(repoPath: string): Promise<CreatedWorktree | null> {
  try {
    return await invoke<CreatedWorktree>('worktree_create', { repoPath });
  } catch (err) {
    console.error('worktree_create failed', err);
    return null;
  }
}
