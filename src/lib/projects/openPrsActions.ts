// Footer "open PRs awaiting review" button: count the OPEN PRs targeting `main`
// that are still AWAITING REVIEW (the Rust `open_prs_for` command runs `gh` and
// returns the count + the repo's pull-requests URL + the full PR list), decide
// the button's icon + label, and — on click — open a POPOVER listing the PRs
// (non-draft first, drafts last) with a pinned "Open PRs page" action. Kept here
// (not inline in the component) so the wiring is unit-tested, mirroring
// `prActions.ts`.
//
// Everything degrades to a NEUTRAL state: when `gh` is missing / unauthenticated
// / errors, the Rust command already collapses to
// `{ count: 0, pullsUrl: null, prs: [] }`, and a thrown invoke is treated the
// same here — the button shows the checkmark/`0` state with no error.

import { invoke } from '@tauri-apps/api/core';

/** The base branch the open PRs target — the whole app treats `main` as base. */
export const DEFAULT_BASE = 'main';

/** The warning glyph (Icon name) shown when one or more PRs await review. */
export const WARNING_ICON = 'triangle-alert';
/** The checkmark glyph (Icon name) shown when none await review (or unknown). */
export const CHECKMARK_ICON = 'check';

/** A single open PR entry, mirroring the Rust `OpenPr` serde shape. */
export interface OpenPr {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  /** The review decision, or `null` when no review has been requested yet. */
  reviewDecision: string | null;
}

/** The open-PRs result, mirroring the Rust `OpenPrs` serde shape. `count` is the
 *  number of open, NON-DRAFT PRs into `main` awaiting review (drafts are never
 *  counted); `pullsUrl` is the repo's pull-requests page (or `null` when it
 *  couldn't be derived); `prs` is the full list for the popover. */
export interface OpenPrs {
  count: number;
  pullsUrl: string | null;
  prs: OpenPr[];
}

/** How the footer should render the open-PRs button. `warning` (count>0) →
 *  warning icon + the count; otherwise the neutral checkmark + `0`. */
export interface OpenPrsView {
  icon: string;
  label: string;
  warning: boolean;
}

/**
 * Best-effort, per-PATH cache of the last-known open-PRs result, refreshed
 * alongside the footer's git status. The footer reads it to render the button
 * without blocking on a fresh `gh` call each render; a missing entry just means
 * the neutral checkmark/`0` state. Keyed by repo path (the count is per-repo, not
 * per-branch — it's all open PRs into `main`).
 */
export const openPrsCache = new Map<string, OpenPrs>();

/**
 * PURE: decide the button's icon + label from an open-PRs result.
 *
 * - `count > 0` → WARNING icon + the count (PRs are waiting on review).
 * - `count === 0`, a non-positive count, or `null`/`undefined` (UNKNOWN — gh
 *   unavailable) → the neutral CHECKMARK icon + `0`, no error.
 *
 * Kept pure + exported so the decision is unit-tested apart from the component.
 */
export function openPrsView(result: OpenPrs | null | undefined): OpenPrsView {
  const count = result?.count ?? 0;
  if (count > 0) {
    return { icon: WARNING_ICON, label: String(count), warning: true };
  }
  return { icon: CHECKMARK_ICON, label: '0', warning: false };
}

/**
 * PURE: sort a list of open PRs for display in the popover — non-draft PRs first,
 * draft PRs last. Within each group the original order is preserved (stable sort).
 * The caller renders all PRs (including approved) but marks drafts visually.
 */
export function sortPrsForPopover(prs: OpenPr[]): OpenPr[] {
  const nonDraft = prs.filter((p) => !p.isDraft);
  const draft = prs.filter((p) => p.isDraft);
  return [...nonDraft, ...draft];
}

/**
 * Query the open-PRs-awaiting-review result for `path`'s `base` via the Rust
 * `open_prs_for` command, cache it under `path`, and return it. A thrown invoke
 * (outside Tauri, or a degenerate error) degrades to the NEUTRAL unknown result
 * `{ count: 0, pullsUrl: null, prs: [] }` — and is cached as such, so the button
 * reads the checkmark/`0` state with no error.
 */
export async function openPrsFor(path: string, base: string = DEFAULT_BASE): Promise<OpenPrs> {
  let result: OpenPrs;
  try {
    result = await invoke<OpenPrs>('open_prs_for', { repoPath: path, base });
  } catch {
    result = { count: 0, pullsUrl: null, prs: [] };
  }
  openPrsCache.set(path, result);
  return result;
}

/**
 * Refresh the open-PRs result for a project's folder (best-effort) and store it
 * in the cache, so the footer's button stays current alongside git status. A
 * missing path is a no-op. Errors are swallowed (cached as the neutral result by
 * `openPrsFor`).
 */
export async function refreshOpenPrs(
  path: string | null | undefined,
  base: string = DEFAULT_BASE
): Promise<void> {
  if (!path) return;
  await openPrsFor(path, base);
}

/** The open-PRs result cached for `path`, or `null` when none is cached yet
 *  (the neutral unknown state — `openPrsView(null)` → checkmark/`0`). */
export function cachedOpenPrs(path: string | null | undefined): OpenPrs | null {
  if (!path) return null;
  return openPrsCache.get(path) ?? null;
}
