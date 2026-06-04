// Open a transcript filename in the editor (Cursor). The overview linkifies
// path-like tokens in the Markdown preview (markdown.ts) into clickable buttons;
// clicking one resolves it against the agent's working directory and asks the
// Rust `open_in_editor` command to launch it.

import { invoke } from '@tauri-apps/api/core';

/** PURE: resolve a (possibly relative) file against the agent's cwd → an absolute
 *  path. An already-absolute path (POSIX `/…` or Windows `C:\…`) is returned as-is;
 *  with no cwd the token is returned unchanged (best-effort). */
export function resolveFile(cwd: string | null, file: string): string {
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file;
  if (!cwd) return file;
  return `${cwd.replace(/[/\\]+$/, '')}/${file}`;
}

/** Open a transcript filename in the editor, resolved against `cwd`. Best-effort:
 *  a failure (no Cursor, outside Tauri) is logged, never thrown. */
export async function openInEditor(cwd: string | null, file: string): Promise<void> {
  try {
    await invoke('open_in_editor', { path: resolveFile(cwd, file) });
  } catch (err) {
    console.warn('open_in_editor failed:', err);
  }
}
