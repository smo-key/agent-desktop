/**
 * Pure label helpers for model id and effort level strings.
 */

const KNOWN_FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable']);

/**
 * Parse a Claude model id of the form `claude-<family>-<num>[-<num>][-<YYYYMMDD>]`
 * and return a human-readable versioned label like `Opus 4.8` or `Sonnet 4.6`.
 * Falls back to `displayName` (if non-empty) then `'—'` when id is null/empty
 * or doesn't match the expected pattern.
 */
export function modelLabel(id: string | null, displayName: string | null): string {
  const fallback = displayName && displayName.length > 0 ? displayName : '—';

  if (!id || id.length === 0) return fallback;

  // Match: claude-<family>-<parts...>
  // parts are numeric segments possibly followed by an 8-digit date suffix.
  const match = id.match(/^claude-([a-z]+)-(.+)$/);
  if (!match) return fallback;

  const family = match[1];
  const rest = match[2];

  if (!KNOWN_FAMILIES.has(family)) return fallback;

  // Split rest on '-' to get version parts (possibly ending with YYYYMMDD date)
  const segments = rest.split('-');

  // Drop any trailing 8-digit date segment (e.g. "20251001")
  const versionParts: string[] = [];
  for (const seg of segments) {
    if (/^\d{8}$/.test(seg)) {
      // 8-digit date suffix — stop collecting
      break;
    }
    if (/^\d+$/.test(seg)) {
      versionParts.push(seg);
    } else {
      // Non-numeric, non-date segment — not a recognized pattern
      return fallback;
    }
  }

  if (versionParts.length === 0) return fallback;

  const capitalizedFamily = family.charAt(0).toUpperCase() + family.slice(1);
  const version = versionParts.join('.');
  return `${capitalizedFamily} ${version}`;
}

/**
 * Convert an effort level string to a human-readable label.
 * Returns null for null/empty input; `'xhigh'` → `'XHigh'`; others → capitalize
 * first letter.
 */
export function effortLabel(level: string | null): string | null {
  if (!level || level.length === 0) return null;
  if (level === 'xhigh') return 'XHigh';
  return level.charAt(0).toUpperCase() + level.slice(1);
}
