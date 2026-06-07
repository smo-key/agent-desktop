// Reactive store for voice-model DOWNLOAD progress (tasks.md 5.3). A singleton so
// the VoicePanel (and optionally the settings modal) can show a "Preparing
// models… NN%" state driven by the streaming `voice_download_models` events. Only
// UI state lives here; the download orchestration is in `models.ts` (which writes
// into this store). The overall-percent math is the pure `overallPercent` helper.

import { overallPercent, type PerModel } from './models';

/** Reactive download-progress store for voice models. */
export class ModelDownloadStore {
  /** True while a download is in flight (a "Preparing models…" overlay shows). */
  active = $state(false);

  /** Per-model byte progress, keyed by model id. */
  perModel = $state<PerModel>({});

  /** Last error message, or null when none. */
  error = $state<string | null>(null);

  /** Overall integer percent (0..100) across all in-flight models. */
  get percent(): number {
    return overallPercent(this.perModel);
  }

  /** Mark everything already present (no download needed): not active, no error. */
  markReady(): void {
    this.active = false;
    this.perModel = {};
    this.error = null;
  }

  /** Begin a download session: clear prior progress/error and go active. */
  begin(): void {
    this.active = true;
    this.perModel = {};
    this.error = null;
  }

  /** Record cumulative bytes for a model (replaces the runes proxy object so the
   *  reactive `percent` getter recomputes). */
  setProgress(id: string, received: number, total: number): void {
    this.perModel = { ...this.perModel, [id]: { received, total } };
  }

  /** Snap a finished model to 100% (received == total) so the bar reads complete
   *  even if the last progress event was throttled below total. */
  markModelDone(id: string): void {
    const cur = this.perModel[id];
    const total = cur?.total ?? 0;
    this.perModel = { ...this.perModel, [id]: { received: total, total } };
  }

  /** Record an error (does not clear progress; the panel surfaces it). */
  setError(msg: string): void {
    this.error = msg;
  }

  /** End the download session (the command returned). Stays not-active; progress
   *  is left intact for a final render, errors preserved. */
  finish(): void {
    this.active = false;
  }
}

/** The singleton model-download store. */
export const modelDownload = new ModelDownloadStore();
