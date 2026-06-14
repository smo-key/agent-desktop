// Reactive state for the background-staged update + the title-bar update pill
// (desktop-auto-update spec). A newer version is detected by the launch check or
// the recurring hourly poll (see checkForUpdate.ts); when found we DOWNLOAD it in
// the background here, moving idle → downloading → ready. While downloading we
// surface progress (`percent`, or indeterminate when the manifest omits a total);
// the title bar renders the pill for downloading/ready/failed/installing and
// activating the `ready` pill INSTALLS the staged bundle and relaunches.
//
// Concurrency: `beginDownload` is the SINGLE mutation point and is safe to call
// from overlapping callers (two hourly ticks, a poll racing the launch check, or
// a manual Settings check). A monotonic `seq` token ensures only the latest
// download commits `staged`/`status`/progress — so `version` (shown in the pill)
// and `staged` (what `install()` applies) never disagree, and a superseded
// download discards its handle instead of overwriting a newer one. Every `Update`
// handle we don't end up installing is `close()`d (a Rust-backed Resource — see
// resource.ts).
//
// A download that was FOUND then errored surfaces a retryable `failed` state (the
// pill offers "Update failed · retry"); this is distinct from a silent check
// failure (no update found), which never touches the store. `retry()` delegates
// to an injected `recheck` (set by checkForUpdate.ts) so the store itself issues
// no `check()` IPC — its only Tauri IPC is `relaunch()`. download()/install()/
// close() live on the `Update` handle, so the transitions are unit-tested
// headlessly (updateStore.svelte.test.ts).

import { relaunch } from '@tauri-apps/plugin-process';
import type { Update, DownloadEvent } from '@tauri-apps/plugin-updater';
import type { UpdateStatus } from './decide';
import { closeUpdate } from './resource';

/**
 * Singleton store tracking the lifecycle of a background-staged update. Imported
 * by the title bar (reads `status`/`version` to render the pill) and by the check
 * orchestration (calls `beginDownload`).
 */
export class UpdateStore {
  /** Lifecycle of the staged update; the pill shows for non-idle states. */
  status = $state<UpdateStatus>('idle');

  /** The version being downloaded/staged (pill tooltip + dedupe), else null. */
  version = $state<string | null>(null);

  /** Bytes downloaded so far in the current download (reset per download). */
  downloadedBytes = $state(0);

  /** Total bytes for the current download, or null when the manifest omits it. */
  totalBytes = $state<number | null>(null);

  /** The last download/stage error (for diagnostics); null unless `failed`. */
  lastError = $state<unknown>(null);

  /**
   * Injected by checkForUpdate.ts: run one `check()` → background-download cycle.
   * Kept as a seam so `retry()` re-checks without the store issuing `check()` IPC.
   * Returns the check outcome, which `retry()` ignores (typed `unknown` to avoid a
   * circular import of checkForUpdate's `CheckOutcome`).
   */
  recheck: (() => Promise<unknown>) | null = null;

  /** The staged `Update` handle, kept so `restartToUpdate()` can install it. */
  private staged: Update | null = null;

  /** Monotonic token: only the latest `beginDownload` may commit/reset state. */
  private seq = 0;

  /**
   * Download percentage (0–100, floored) when the total size is known, else null
   * (indeterminate). Reactive: reads the `$state` byte counters.
   */
  get percent(): number | null {
    if (!this.totalBytes) return null;
    return Math.floor((this.downloadedBytes / this.totalBytes) * 100);
  }

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
    // consistent {status, version, progress}). A newer version supersedes an older
    // staged one — capture it to close after the flip. Progress counters reset so a
    // prior run's bytes don't leak into this one.
    const superseded = this.staged;
    const mine = ++this.seq;
    this.staged = null;
    this.status = 'downloading';
    this.version = update.version;
    this.downloadedBytes = 0;
    this.totalBytes = null;
    this.lastError = null;
    if (superseded) await closeUpdate(superseded);

    // Progress callback: only the latest download (seq token) may move the
    // reactive counters, so a stale superseded download's events are ignored.
    const onEvent = (e: DownloadEvent): void => {
      if (this.seq !== mine) return;
      if (e.event === 'Started') {
        this.totalBytes = e.data.contentLength ?? null;
        this.downloadedBytes = 0;
      } else if (e.event === 'Progress') {
        this.downloadedBytes += e.data.chunkLength;
      }
    };

    try {
      await update.download(onEvent);
    } catch (err) {
      console.warn('update download failed:', err);
      await closeUpdate(update);
      // Only the latest download may surface failure; a stale (superseded) reject
      // must not clobber a newer 'ready'/'downloading' state.
      if (this.seq === mine) this.fail(err);
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
   * Re-check for an update and re-attempt its download — the action behind the
   * pill's "Update failed · retry" affordance. Only meaningful from `failed`;
   * delegates to the injected `recheck` so the store issues no `check()` IPC.
   */
  async retry(): Promise<void> {
    if (this.status !== 'failed') return;
    await this.recheck?.();
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

  /**
   * Move to the retryable `failed` state after a found update's download/stage
   * errored. Keeps `version` (what failed, for context) but drops the staged
   * handle and zeroes progress. A later check/poll/retry for any version flips
   * back to `downloading` (then `ready`), clearing this state.
   */
  private fail(err: unknown): void {
    this.status = 'failed';
    this.lastError = err;
    this.staged = null;
    this.downloadedBytes = 0;
    this.totalBytes = null;
  }
}

/** The singleton update store. */
export const updateStore = new UpdateStore();
