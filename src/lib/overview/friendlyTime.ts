// PURE helper: format an agent's last-activity timestamp (the snapshot `ts`, unix
// SECONDS) as a short, friendly relative string for the roster card's meta row —
// "just now", "3m ago", "2h ago", "yesterday", "5d ago", or an absolute "May 7"
// once it is older than a week. Framework-free (no Svelte/Tauri), unit-tested in
// friendlyTime.test.ts. A null/non-finite/future timestamp yields "—".

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

/**
 * Friendly relative time from `tsSeconds` (unix SECONDS) to `nowMs` (epoch ms):
 *  - <45s            -> "just now"
 *  - <60m            -> "Nm ago"   (rounded, min 1)
 *  - <24h            -> "Nh ago"   (rounded)
 *  - <48h            -> "yesterday"
 *  - <7d             -> "Nd ago"   (floored)
 *  - otherwise       -> absolute "Mon D" (local calendar date)
 *
 * Null / non-finite / a timestamp in the future returns "—".
 */
export function friendlyTime(tsSeconds: number | null, nowMs: number): string {
  if (tsSeconds === null || !Number.isFinite(tsSeconds)) return '—';
  const tsMs = tsSeconds * 1000;
  const diff = nowMs - tsMs;
  if (!Number.isFinite(diff) || diff < 0) return '—';

  const sec = diff / 1000;
  if (sec < 45) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.max(1, Math.round(min))}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 2) return 'yesterday';
  if (day < 7) return `${Math.floor(day)}d ago`;

  const d = new Date(tsMs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
