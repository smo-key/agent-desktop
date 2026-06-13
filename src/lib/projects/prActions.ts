// Footer PR-button actions: look up the open PR from a project's current branch
// into the base (`main`), decide whether clicking OPENS the existing PR or opens
// a CREATE-confirm dialog, and — on confirm — spawn an auto-archiving agent task
// that creates the PR. Kept here (not inline in GitInfo.svelte) so the wiring is
// unit-tested, mirroring `projectGitActions.ts`.
//
// Status lookup degrades to `unknown` whenever existence can't be determined (gh
// missing / unauthenticated / errored — the Rust command already collapses those
// to `{ kind: 'unknown' }`, and a thrown invoke is treated the same here). The
// spec requires the button then fall back to the create-confirm path, NOT do
// nothing — see `onPrButtonClick`.

import { invoke } from '@tauri-apps/api/core';
import { confirmModal } from '../ui/confirmStore.svelte';

/** The base branch every PR targets. The whole app treats `main` as the base
 *  (ahead/behind are computed vs `origin/main`), so the PR button matches. */
export const DEFAULT_BASE = 'main';

/** The PR-status result, mirroring the Rust `PrStatus` enum's serde shape
 *  (`#[serde(tag = "kind")]`). `exists` carries the PR url + number; `none` is a
 *  clean "no open PR"; `unknown` means existence couldn't be determined. */
export type PrStatus =
  | { kind: 'exists'; url: string; number: number }
  | { kind: 'none' }
  | { kind: 'unknown' };

/** A minimal project shape — just what the PR actions need. */
export interface PrProject {
  id: string;
  path: string | null | undefined;
  name: string;
}

/**
 * The injected agent-task launcher (set by the app at startup; see `+page.svelte`).
 * `fn(projectId, prompt)` spawns a Claude session in that project seeded with the
 * prompt and registers it for auto-archive. Kept generic (projectId + prompt), NOT
 * PR-specific, so a later commit-button task can reuse the SAME hook. `null` until
 * set (and in unit tests), in which case a confirmed create is a no-op.
 */
export type AgentTaskLauncher = (projectId: string, prompt: string) => void;
let agentTaskLauncher: AgentTaskLauncher | null = null;

/** Install (or clear, with `null`) the agent-task launcher used to create a PR. */
export function setAgentTaskLauncher(fn: AgentTaskLauncher | null): void {
  agentTaskLauncher = fn;
}

/**
 * Best-effort, per-BRANCH cache of the last-known PR status, refreshed alongside
 * the footer's git status. The footer reads it to render the button's intent
 * (open vs create) without blocking on a fresh `gh` call each render; a stale or
 * missing entry just means the click falls back to the create-confirm path. Keyed
 * by branch name so switching branches doesn't show a wrong PR.
 */
export const prCache = new Map<string, PrStatus>();

/**
 * Query the open-PR status for `path`'s current branch into `base` via the Rust
 * `pr_status_for` command, cache it under `branch`, and return it. A thrown
 * invoke (outside Tauri, or a degenerate error) degrades to `{ kind: 'unknown' }`
 * — the create-confirm fallback — and is cached as such.
 */
export async function prStatusFor(
  path: string,
  branch: string,
  base: string = DEFAULT_BASE
): Promise<PrStatus> {
  let status: PrStatus;
  try {
    status = await invoke<PrStatus>('pr_status_for', { repoPath: path, base });
  } catch {
    status = { kind: 'unknown' };
  }
  prCache.set(branch, status);
  return status;
}

/**
 * Refresh PR status for a project's CURRENT branch (best-effort) and store it in
 * the cache, so the footer's button intent stays current alongside git status. A
 * missing path/branch, or a base/missing branch (the button is disabled there
 * anyway), is a no-op. Errors are swallowed (cached as `unknown` by `prStatusFor`).
 */
export async function refreshPrStatus(
  path: string | null | undefined,
  branch: string | null | undefined,
  base: string = DEFAULT_BASE
): Promise<void> {
  if (!path || !branch || branch === base) return;
  await prStatusFor(path, branch, base);
}

/** The PR-status cached for `branch`, or `unknown` when none is cached yet. */
export function cachedPrStatus(branch: string | null | undefined): PrStatus {
  if (!branch) return { kind: 'unknown' };
  return prCache.get(branch) ?? { kind: 'unknown' };
}

/**
 * The agent prompt that creates the PR. Instructs the session to push the current
 * branch and open a pull request INTO `base` with `gh`, then hand back to the
 * user (so the auto-archive effect can close the fire-and-forget task). Kept pure
 * + exported so its shape is unit-tested.
 */
export function buildCreatePrPrompt(base: string = DEFAULT_BASE): string {
  return [
    `Create a GitHub pull request from the current branch into \`${base}\`.`,
    '',
    'Steps:',
    `1. Make sure the current branch is pushed to the remote (\`git push -u origin HEAD\` if it has no upstream).`,
    `2. Open a pull request into \`${base}\` with \`gh pr create --base ${base} --fill\` (let gh derive the title/body from the commits; add a short body summarizing the change if --fill is sparse).`,
    `3. Print the resulting PR URL and then stop — do not merge it.`,
    '',
    'If a PR from this branch already exists, just print its URL instead of creating a duplicate.'
  ].join('\n');
}

/**
 * The agent prompt that COMMITS the pending working-tree changes. Instructs the
 * session to GROUP the changes into one or more logical commits BY CONTENT — each
 * commit a single coherent concern (a feature, a fix, a refactor, a docs/chore
 * change) with files staged selectively — on the CURRENT branch, then hand back to
 * the user (so the auto-archive effect closes the fire-and-forget task). Crucially
 * it must NOT push and NOT open a PR — committing locally is the whole job. Kept
 * pure + exported so its shape is unit-tested (mirrors `buildCreatePrPrompt`).
 */
export function buildCommitPrompt(): string {
  return [
    'Commit the pending uncommitted changes in this repository on the CURRENT branch.',
    '',
    'Split the changes into one or more commits grouped BY CONTENT — each commit a single,',
    'coherent concern (e.g. one feature, one fix, one refactor, one docs/chore change). Do not',
    'lump unrelated changes together; if everything is genuinely one concern, a single commit is fine.',
    '',
    'Steps:',
    '1. Review the working-tree changes (`git status` and `git diff`) so you understand every change.',
    '2. Group the changes into logical units by concern, and for each unit:',
    '   - Stage ONLY that unit\'s files/hunks (`git add <paths>`, or `git add -p` to split a file).',
    '   - Create one commit with a clear, conventional-commits message (e.g. `feat: …`, `fix: …`, `chore: …`)',
    '     describing that unit.',
    '3. Repeat until the working tree is clean (no remaining uncommitted changes).',
    '4. Print the resulting commits (`git log` of the new commits) and then stop.',
    '',
    'Do NOT push the branch and do NOT open a pull request — just create the local commits on the current branch.'
  ].join('\n');
}

/**
 * Open a URL externally (the user's default browser) via the `open_path`
 * command — the same command the app uses to open files/folders; on macOS `open
 * <url>` hands an http(s) URL to the default browser. Best-effort; a failure is
 * logged, not thrown.
 */
async function openExternal(url: string): Promise<void> {
  try {
    await invoke('open_path', { path: url, app: null });
  } catch (err) {
    console.warn('open_path (PR url) failed', err);
  }
}

/**
 * Spawn the auto-archiving agent task that creates a PR into `base` for
 * `project`. No-op (warns) when no launcher is wired or the project has no folder.
 */
function spawnCreatePr(project: PrProject, base: string): void {
  if (!project.path) return;
  if (!agentTaskLauncher) {
    console.warn('PR create: no agent-task launcher wired');
    return;
  }
  agentTaskLauncher(project.id, buildCreatePrPrompt(base));
}

/**
 * Spawn the auto-archiving agent task that COMMITS the pending changes for
 * `project`, reusing the SAME `agentTaskLauncher` (and thus the same `+page.svelte`
 * `taskAgentPanes` auto-archive wiring) as the PR action — NOT a second launcher.
 * No-op (warns) when no launcher is wired or the project has no folder.
 *
 * Exported so the commit popover (FooterPopover + GitInfo wiring) can spawn
 * directly on "Commit now" without going through the old ConfirmModal path.
 */
export function spawnCommit(project: PrProject): void {
  if (!project.path) return;
  if (!agentTaskLauncher) {
    console.warn('commit: no agent-task launcher wired');
    return;
  }
  agentTaskLauncher(project.id, buildCommitPrompt());
}

/**
 * Handle a PR-button click given the (cached) `status` for the current `branch`.
 *
 * - `exists` → open the PR on GitHub (external open); no dialog.
 * - `none` OR `unknown` → open a confirm dialog to create a PR into `base`;
 *   confirming spawns the auto-archiving create-PR agent task. (Unknown falls
 *   back to create — never "do nothing".)
 *
 * Cancelling the dialog fires nothing. Pure-ish: all side effects go through the
 * mocked `invoke` / `confirmModal` / injected launcher, so the decision is
 * unit-tested.
 */
export async function onPrButtonClick(
  project: PrProject,
  branch: string,
  base: string,
  status: PrStatus
): Promise<void> {
  if (status.kind === 'exists') {
    await openExternal(status.url);
    return;
  }
  // none OR unknown → confirm-to-create (the spec's fallback for unknown).
  confirmModal.show({
    title: 'Create pull request',
    message: `No open pull request from "${branch}" into ${base} was found. Create one? This starts an agent session that pushes the branch and opens the PR into ${base}.`,
    confirmLabel: 'Create PR',
    onConfirm: () => spawnCreatePr(project, base)
  });
}
