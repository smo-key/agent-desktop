// Reactive state for the background-staged update + the "Restart to update" pill
// (desktop-auto-update spec). A newer version is detected by the launch check
// ("Later" path) or the recurring hourly poll (see checkForUpdate.ts); when found
// we DOWNLOAD it in the background here, moving idle → downloading → ready. The
// title bar renders the orange pill while `status === 'ready'`, and activating it
// INSTALLS the staged bundle and relaunches into the new version.
//
// Concurrency: `beginDownload` is the SINGLE mutation point and is safe to call
// from overlapping callers (two hourly ticks, or a poll racing the launch
// "Later" path). A monotonic `seq` token ensures only the latest download commits
// `staged`/`status` — so `version` (shown in the pill) and `staged` (what
// `install()` applies) never disagree, and a superseded download discards its
// handle instead of overwriting a newer one. Every `Update` handle we don't end
// up installing is `close()`d (it's a Rust-backed Resource — see resource.ts).
//
// Best-effort: any download failure resets to idle (silent, retried next poll).
// The single Tauri IPC is `relaunch()`; download()/install()/close() live on the
// `Update` handle, so the transitions are unit-tested headlessly
// (updateStore.svelte.test.ts).

import { relaunch } from '@tauri-apps/plugin-process';
import type { Update } from '@tauri-apps/plugin-updater';
import type { UpdateStatus } from './decide';
import { closeUpdate } from './resource';

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

  /** Monotonic token: only the latest `beginDownload` may commit/reset state. */
  private seq = 0;

  /** A plain snapshot for the pure `decideCheckAction` dedupe (no reactivity). */
  get snapshot(): { status: UpdateStatus; version: string | null } {
    return { status: this.status, version: this.version };
  }

  /**
   * Download + stage an available update in the background. On success the status
   * becomes `ready` and the pill appears; any failure resets to idle (silent).
   *
   * Concurrency-safe and idempotent at the version level: if we're already
   * handling THIS version (downloading/ready), or mid-install, the redundant
   * handle is closed and we bail. A genuinely newer version supersedes an older
   * in-flight/staged one — the older handle is closed and only the newest
   * download is allowed to commit (`seq` token).
   */
  async beginDownload(update: Update): Promise<void> {
    // Already installing → about to relaunch; don't disturb the staged handle.
    if (this.status === 'installing') {
      await closeUpdate(update);
      return;
    }
    // Already handling this exact version (launch-vs-poll race, or an hourly
    // re-check of a staged version) → drop the redundant handle, no 2nd download.
    if (
      (this.status === 'downloading' || this.status === 'ready') &&
      this.version === update.version
    ) {
      await closeUpdate(update);
      return;
    }

    // Synchronous state flip (no await between these, so any reader sees a
    // consistent {status, version}). A newer version supersedes an older staged
    // one — capture it to close after the flip.
    const superseded = this.staged;
    const mine = ++this.seq;
    this.staged = null;
    this.status = 'downloading';
    this.version = update.version;
    if (superseded) await closeUpdate(superseded);

    try {
      await update.download();
    } catch (err) {
      console.warn('update download failed:', err);
      await closeUpdate(update);
      if (this.seq === mine) this.reset(); // only the latest may reset shared state
      return;
    }

    // Superseded mid-download by a newer beginDownload → this handle is stale.
    if (this.seq !== mine) {
      await closeUpdate(update);
      return;
    }
    this.staged = update;
    this.status = 'ready';
  }

  /**
   * Install the staged update and relaunch into the new version. No-op unless an
   * update is actually staged (`ready`). Flips to `installing` SYNCHRONOUSLY so a
   * second click (the button is still rendered until relaunch) can't double-apply.
   */
  async restartToUpdate(): Promise<void> {
    if (this.status !== 'ready' || !this.staged) return;
    const update = this.staged;
    this.status = 'installing'; // re-entrancy guard: a second click fails the check
    try {
      await update.install();
      await relaunch(); // on success the app restarts; nothing below runs
    } catch (err) {
      // install/relaunch failed — restore the pill so the user can retry, rather
      // than getting stuck in a hidden 'installing' state for the rest of the
      // session (the staged handle is still good).
      console.warn('update install/relaunch failed:', err);
      this.status = 'ready';
    }
  }

  private reset(): void {
    this.status = 'idle';
    this.version = null;
    this.staged = null;
  }
}

/** The singleton update store. */
export const updateStore = new UpdateStore();
