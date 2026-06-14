// Reactive state for the background-staged update + the "Restart to update" pill
// (desktop-auto-update spec). A newer version is detected by the launch check
// ("Later" path) or the recurring hourly poll (see checkForUpdate.ts); when found
// we DOWNLOAD it in the background here, moving idle → downloading → ready. The
// title bar renders the orange pill while `status === 'ready'`, and activating it
// INSTALLS the staged bundle and relaunches into the new version.
//
// Best-effort: any download failure resets to idle (silent, retried next poll),
// so the pill only ever appears for a genuinely staged update. The single Tauri
// IPC is `relaunch()`; download()/install() live on the `Update` handle, so the
// transitions are unit-tested headlessly (updateStore.svelte.test.ts).

import { relaunch } from '@tauri-apps/plugin-process';
import type { Update } from '@tauri-apps/plugin-updater';
import type { UpdateStatus } from './decide';

/**
 * Singleton store tracking the lifecycle of a background-staged update. Imported
 * by the title bar (reads `status`/`version` to render the pill) and by the check
 * orchestration (calls `beginDownload`).
 */
export class UpdateStore {
  /** Lifecycle of the staged update; the pill shows on `ready`. */
  status = $state<UpdateStatus>('idle');

  /** The version being downloaded/staged (pill tooltip + dedupe), else null. */
  version = $state<string | null>(null);

  /** The staged `Update` handle, kept so `restartToUpdate()` can install it. */
  private staged: Update | null = null;

  /** A plain snapshot for the pure `decideCheckAction` dedupe (no reactivity). */
  get snapshot(): { status: UpdateStatus; version: string | null } {
    return { status: this.status, version: this.version };
  }

  /**
   * Download + stage an available update in the background. On success the status
   * becomes `ready` and the pill appears; any failure resets to idle (silent).
   */
  async beginDownload(update: Update): Promise<void> {
    this.status = 'downloading';
    this.version = update.version;
    try {
      await update.download();
      this.staged = update;
      this.status = 'ready';
    } catch (err) {
      console.warn('update download failed:', err);
      this.reset();
    }
  }

  /**
   * Install the staged update and relaunch into the new version. No-op unless an
   * update is actually staged (`ready`), so a stray click can never half-apply.
   */
  async restartToUpdate(): Promise<void> {
    if (this.status !== 'ready' || !this.staged) return;
    await this.staged.install();
    await relaunch();
  }

  private reset(): void {
    this.status = 'idle';
    this.version = null;
    this.staged = null;
  }
}

/** The singleton update store. */
export const updateStore = new UpdateStore();
