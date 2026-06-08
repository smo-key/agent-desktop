// View-model for the project WORKTREE-MANAGEMENT dialog (add-project-auto-worktree,
// group 6). The `.svelte.ts` module owns the tested logic — listing a project's
// worktrees, opening one into a new session, and pruning one — while
// `WorktreeDialog.svelte` stays a thin renderer over this state.
//
// Lists via the Rust `worktree_list` command, removes via `worktree_remove`.
// Both go through the same `invoke` channel the launch flow uses; errors are
// surfaced non-blockingly via the toast store and never throw out of the panel.

import { invoke } from '@tauri-apps/api/core';
import { workspace } from '../layout/workspace.svelte';
import { buildLaunchPlan } from '../launcher/plan';
import { toast } from '../ui/toastStore.svelte';

/** One worktree as `worktree_list` reports it (mirrors the Rust struct). */
export interface Worktree {
  /** Absolute path of the worktree. */
  path: string;
  /** The branch the worktree is checked out on (may be null for a detached HEAD). */
  branch: string | null;
  /** Whether the worktree's working tree is clean (no uncommitted changes). */
  clean: boolean;
}

export class WorktreePanel {
  /** The project's repo path, remembered so a post-prune refresh can re-list. */
  repoPath = $state('');
  /** The project's worktrees, as last loaded. Deep-reactive via the runes proxy. */
  worktrees = $state<Worktree[]>([]);

  /** The project these worktrees belong to — its id binds opened sessions. */
  constructor(private readonly projectId: string) {}

  /**
   * Load the project's worktrees from `worktree_list`. Records `repoPath` so a
   * later prune can refresh. On error the list is left empty and a toast warns.
   */
  async load(repoPath: string): Promise<void> {
    this.repoPath = repoPath;
    try {
      this.worktrees = await invoke<Worktree[]>('worktree_list', { repoPath });
    } catch (err) {
      console.error('worktree_list failed', err);
      this.worktrees = [];
      toast.show("Couldn't list worktrees.");
    }
  }

  /**
   * Open a new session whose working directory IS the worktree's path. Uses the
   * shared launch path (`buildLaunchPlan` + `workspace.launch`) with NO
   * `worktreeBase` — opening an EXISTING worktree must not mark it for auto-removal
   * on close (auto-cleanup only applies to sessions that auto-created the worktree).
   */
  open(wt: Worktree): void {
    workspace.launch(
      buildLaunchPlan({
        folder: wt.path,
        prompt: '',
        placement: 'tab',
        projectId: this.projectId
      })
    );
  }

  /**
   * Remove a worktree via `worktree_remove`. A CLEAN worktree prunes directly; a
   * worktree WITH CHANGES requires explicit confirmation before a FORCED removal,
   * gated by the same native `confirm(...)` convention the panel uses for delete.
   * On success the list refreshes; on error a toast warns.
   */
  async prune(wt: Worktree): Promise<void> {
    let force = false;
    if (!wt.clean) {
      const ok =
        typeof confirm === 'function'
          ? confirm(
              `Worktree "${wt.path}" has uncommitted changes. Force-remove it? This discards those changes.`
            )
          : true;
      if (!ok) return;
      force = true;
    }

    try {
      await invoke('worktree_remove', { worktreePath: wt.path, force });
    } catch (err) {
      console.error('worktree_remove failed', err);
      toast.show("Couldn't remove worktree.");
      return;
    }

    // Refresh so the pruned worktree drops out of the list.
    await this.load(this.repoPath);
  }
}
