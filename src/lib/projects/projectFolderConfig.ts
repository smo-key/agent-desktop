// Thin async helpers over the per-project config Rust commands
// (project-folder-storage capability). The per-project `autoWorktree` setting
// lives in `<project>/.agent-desktop/config.json`; all parsing/serialization
// logic is in the already-tested pure `parseProjectConfig`/`serializeProjectConfig`.

import { invoke } from '@tauri-apps/api/core';
import { parseProjectConfig, serializeProjectConfig } from '../tasks/projectTasks';

/** Read a project's `autoWorktree` from its folder config (defaults to `false`). */
export async function loadAutoWorktree(path: string): Promise<boolean> {
  try {
    const raw = await invoke<string | null>('project_config_load', { projectPath: path });
    return parseProjectConfig(raw).autoWorktree ?? false;
  } catch (err) {
    console.error('project_config_load failed', path, err);
    return false;
  }
}

/** Write a project's `autoWorktree` to its folder config. */
export async function saveAutoWorktree(path: string, value: boolean): Promise<void> {
  try {
    await invoke('project_config_save', {
      projectPath: path,
      json: serializeProjectConfig({ autoWorktree: value })
    });
  } catch (err) {
    console.error('project_config_save failed', path, err);
  }
}
