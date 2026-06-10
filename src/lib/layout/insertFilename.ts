// The "Insert Filename" foundation (terminal insert-filename spec). The user
// picks a file via the native dialog; its ABSOLUTE path — wrapped in double
// quotes — is pasted into the focused terminal at the cursor (a plain
// `pty_write`, the same path the context-menu Paste uses). The menu item,
// PaneNode wiring, and ⌘I shortcut live elsewhere and all funnel through the
// ONE pick→quote→paste flow here ([`insertFilenameInto`]), so the quoting and
// the "cancel inserts nothing" contract are defined in exactly one place.
//
// The load-bearing, pure part — [`quotePath`] — and the flow are unit-tested
// without the native dialog or the live store: `insertFilenameInto` takes an
// injectable `pick`, and `quotePath` is a string-in/string-out helper. Only the
// thin resolvers that reach the real dialog / workspace store
// ([`focusedTerminalHandle`], [`pickFile`]) are left untested (manual / store
// verification), matching the pattern in `src/lib/voice/insert.ts`.

import { getTerminal, type TerminalHandle } from './terminals';
import { workspace } from './workspace.svelte';
import { findLeaf } from './tree';
import { pickFile } from '../launcher/pickFile';

/**
 * PURE: wrap an absolute path so it can be pasted into a shell/agent terminal as
 * a single argument — surround it with double quotes and escape any embedded `"`
 * as `\"`. NO trailing space is appended (the caller decides spacing), so the
 * result never ends in a space.
 */
export function quotePath(abs: string): string {
  return `"${abs.replace(/"/g, '\\"')}"`;
}

/**
 * The ONE pick→quote→paste flow. Call `pick()` (defaulting to the native
 * [`pickFile`]); if it resolves a non-null path AND `handle` is defined, paste
 * the quoted path into that terminal. If pick resolves `null` (cancel /
 * unavailable dialog) OR `handle` is undefined (no focused terminal) → do
 * nothing (never throw). The injectable `pick` makes the flow unit-testable
 * without the native dialog.
 */
export async function insertFilenameInto(
  handle: TerminalHandle | undefined,
  pick: () => Promise<string | null> = pickFile
): Promise<void> {
  const path = await pick();
  if (path == null || !handle) return;
  handle.paste(quotePath(path));
}

/**
 * Resolve the active workspace's FOCUSED terminal handle, or `undefined`.
 * `workspace.focusedId` is a structural LEAF id (NOT a paneId), so map it
 * through the tree (`findLeaf → leaf.paneId`) before the registry lookup —
 * passing the leaf id straight to `getTerminal` is a known bug (see the comment
 * on `focusedPaneIdInActive` in `src/lib/voice/insert.ts`). Thin, untested
 * wrapper; guarded so it is `undefined` before the store is initialized.
 */
export function focusedTerminalHandle(): TerminalHandle | undefined {
  try {
    const leafId = workspace.focusedId;
    if (!leafId) return undefined;
    const paneId = findLeaf(workspace.root, leafId)?.paneId;
    if (!paneId) return undefined;
    return getTerminal(paneId);
  } catch {
    return undefined;
  }
}
