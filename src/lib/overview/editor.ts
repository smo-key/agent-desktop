// Open a transcript filename. The overview linkifies path-like tokens in the
// Markdown preview (markdown.ts) into clickable buttons; clicking one resolves it
// against the agent's working directory and opens it via the user's open-with
// preferences (the same routing as a ⌘-click in a terminal): code/html/other each
// go to the configured app, or the OS default.

import { openWith } from '$lib/settings/openWith.svelte';

/** PURE: resolve a (possibly relative) file against the agent's cwd → an absolute
 *  path. An already-absolute path (POSIX `/…` or Windows `C:\…`) is returned as-is;
 *  with no cwd the token is returned unchanged (best-effort). */
export function resolveFile(cwd: string | null, file: string): string {
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file;
  if (!cwd) return file;
  return `${cwd.replace(/[/\\]+$/, '')}/${file}`;
}

/** Open a transcript filename per the open-with preferences, resolved against
 *  `cwd`. The same `cwd` is the project root passed to a workspace-capable editor,
 *  so it opens the project (not the file's folder) and reveals the file within it.
 *  Best-effort: a failure (app missing, outside Tauri) is logged, not thrown. */
export async function openInEditor(cwd: string | null, file: string): Promise<void> {
  await openWith.openFile(resolveFile(cwd, file), cwd);
}
