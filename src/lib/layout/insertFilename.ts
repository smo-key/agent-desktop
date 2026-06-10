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
 * a SINGLE literal argument. We surround it with double quotes and backslash-
 * escape every character that is special INSIDE POSIX double quotes — backslash
 * (`\`), double quote (`"`), dollar (`$`) and backtick (`` ` ``) — in one pass.
 * This makes a crafted filename inert: it cannot break out of the quotes (e.g. a
 * name containing `\"`) nor trigger parameter/command expansion (`$VAR`, `$(…)`,
 * `` `…` ``) when the user presses Enter. NO trailing space is appended (the
 * caller decides spacing), so the result never ends in a space.
 *
 * One-pass `[\\"$`]` + `\\$&` prepends a single backslash to each special char,
 * including backslashes we did not add, so escaping is unambiguous and order-free.
 */
export function quotePath(abs: string): string {
  return `"${abs.replace(/[\\"$`]/g, '\\$&')}"`;
}

/**
 * The ONE pick→quote→paste flow. If `handle` is undefined (no live terminal) →
 * do nothing AND open NO dialog (so ⌘I with nothing focused, or the menu on a
 * closed session, is a clean no-op — never a pointless native dialog). Otherwise
 * call `pick()` (defaulting to the native [`pickFile`]); on a non-null path paste
 * its quoted form into the terminal; on `null` (cancel / unavailable dialog) do
 * nothing. Never throws. The injectable `pick` makes the flow unit-testable
 * without the native dialog.
 */
export async function insertFilenameInto(
  handle: TerminalHandle | undefined,
  pick: () => Promise<string | null> = pickFile
): Promise<void> {
  // Check the target BEFORE opening the dialog: no live terminal → no dialog.
  if (!handle) return;
  const path = await pick();
  if (path == null) return;
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
