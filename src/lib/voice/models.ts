// Frontend mirror of the Rust voice-model REGISTRY + download surface
// (src-tauri/src/models.rs). Two Tauri commands back this:
//   - `voice_models_status(tier, polish) -> ModelsStatus` — what's missing.
//   - `voice_download_models(tier, polish, onEvent) -> void` — streams progress.
// `ensureModels` ties them together: check readiness, and if not ready, download
// while reflecting per-model progress into the reactive `modelDownload` store so
// the panel can show "Preparing models… NN%". The pure overall-percent
// aggregation is extracted to `overallPercent` for headless unit testing.

import { Channel, invoke } from '@tauri-apps/api/core';
import { modelDownload } from './modelStore.svelte';

/** TS mirror of the Rust `DownloadEvent` (internally tagged on `event`). */
export type DownloadEvent =
  | { event: 'start'; id: string; total: number }
  | { event: 'progress'; id: string; received: number; total: number }
  | { event: 'done'; id: string }
  | { event: 'error'; id: string; message: string };

/** TS mirror of the Rust `ModelsStatus`. */
export interface ModelsStatus {
  ready: boolean;
  missing: string[];
}

/** Per-model byte progress, keyed by model id. */
export type PerModel = Record<string, { received: number; total: number }>;

/**
 * PURE: overall download percent (0..100, integer) aggregated across all models
 * in `perModel` — summed received over summed total. An empty map or a zero total
 * yields 0 (nothing meaningful to show yet). Received is clamped to total so a
 * server lying about Content-Length can't exceed 100.
 */
export function overallPercent(perModel: PerModel): number {
  let received = 0;
  let total = 0;
  for (const k of Object.keys(perModel)) {
    const m = perModel[k];
    total += m.total;
    received += Math.min(m.received, m.total);
  }
  if (total <= 0) return 0;
  return Math.min(100, Math.floor((received / total) * 100));
}

// --- Display catalog (mirror of the Rust registry, for the onboarding gate) ----
//
// The Rust `models.rs` registry is the source of truth for filenames/sizes; this
// is a DISPLAY-ONLY mirror so the first-launch gate can show a friendly label and
// human size for each missing model. Keep filenames/`approxBytes` in sync with
// `models.rs` (TINY / SMALL / LARGE_V3_TURBO / POLISH).
const CATALOG: Record<string, { label: string; approxBytes: number }> = {
  'ggml-tiny.bin': { label: 'Live transcription', approxBytes: 77_700_000 },
  'ggml-small.bin': { label: 'Fast transcription', approxBytes: 487_600_000 },
  'ggml-large-v3-turbo-q5_0.bin': {
    label: 'Accurate transcription',
    approxBytes: 574_000_000
  },
  'Qwen3-1.7B-Q8_0.gguf': { label: 'Transcript polish', approxBytes: 1_834_426_016 }
};

/**
 * PURE: format a byte count as a short human size ("1.8 GB", "574 MB"). GB-scale
 * sizes (>= 1 GB) get one decimal; smaller sizes round to whole MB. Zero/unknown
 * renders as an em dash so an unsized row reads cleanly. Uses decimal (1000-based)
 * units to match how the registry's `approx_bytes` and download hosts report sizes.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const GB = 1_000_000_000;
  const MB = 1_000_000;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

/** A single model row for the onboarding gate's download list. */
export interface DownloadRow {
  filename: string;
  label: string;
  size: string;
}

/**
 * PURE: turn the `missing` filenames from a `ModelsStatus` into display rows
 * (friendly label + human size) plus the summed `totalBytes`. A filename absent
 * from the catalog is still listed — labelled by its raw filename with an unknown
 * (dash) size and contributing 0 to the total — so a registry/catalog drift never
 * hides a model the backend says is missing.
 */
export function downloadRows(missing: string[]): { rows: DownloadRow[]; totalBytes: number } {
  let totalBytes = 0;
  const rows = missing.map((filename) => {
    const entry = CATALOG[filename];
    const bytes = entry?.approxBytes ?? 0;
    totalBytes += bytes;
    return { filename, label: entry?.label ?? filename, size: formatBytes(bytes) };
  });
  return { rows, totalBytes };
}

/** Query current model readiness for the given selection. Never throws — any
 *  backend failure resolves to "not ready, nothing known missing" so the caller
 *  degrades gracefully (it will attempt a download, which surfaces real errors). */
export async function modelsStatus(
  tier: string,
  polish: boolean
): Promise<ModelsStatus> {
  try {
    return await invoke<ModelsStatus>('voice_models_status', { tier, polish });
  } catch {
    return { ready: false, missing: [] };
  }
}

/**
 * Ensure all models the (tier, polish) selection needs are present, downloading
 * the missing ones with live progress reflected into `modelDownload`. Resolves
 * once the download command returns (or immediately if already ready). The store
 * is the source of truth the UI renders; this function never throws — a transport
 * failure is recorded as `modelDownload.error`.
 */
export async function ensureModels(tier: string, polish: boolean): Promise<void> {
  const status = await modelsStatus(tier, polish);
  if (status.ready) {
    modelDownload.markReady();
    return;
  }

  modelDownload.begin();
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = (msg) => {
    switch (msg.event) {
      case 'start':
        modelDownload.setProgress(msg.id, 0, msg.total);
        break;
      case 'progress':
        modelDownload.setProgress(msg.id, msg.received, msg.total);
        break;
      case 'done':
        modelDownload.markModelDone(msg.id);
        break;
      case 'error':
        modelDownload.setError(msg.message);
        break;
    }
  };

  try {
    await invoke('voice_download_models', { tier, polish, onEvent: channel });
  } catch (e) {
    modelDownload.setError(e instanceof Error ? e.message : String(e));
  } finally {
    modelDownload.finish();
  }
}
