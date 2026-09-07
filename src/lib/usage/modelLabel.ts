/**
 * Pure label helpers for model id and effort level strings.
 */

const KNOWN_FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable']);

/** Segments rendered as ACRONYMS by the generic (non-Claude) prettifier. */
const ACRONYM_SEGMENTS = new Set(['gpt', 'o1', 'o3', 'o4']);

/**
 * Generic readable label for a NON-Claude model id (Copilot sessions report ids
 * like `gpt-5`, `o4-mini`, `gemini-2.5-pro`): segments joined with spaces,
 * known acronym segments uppercased, version segments kept verbatim, everything
 * else capitalized. `null` when the id yields nothing renderable.
 */
export function genericModelLabel(id: string): string | null {
  const segments = id.split('-').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  return segments
    .map((seg) => {
      if (ACRONYM_SEGMENTS.has(seg.toLowerCase())) return seg.toUpperCase();
      if (/^\d+(\.\d+)?$/.test(seg)) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    })
    .join(' ');
}

/**
 * Parse a Claude model id of the form `claude-<family>-<num>[-<num>][-<YYYYMMDD>]`
 * and return a human-readable versioned label like `Opus 4.8` or `Sonnet 4.6`.
 * Falls back to `displayName` (if non-empty), then — for a non-Claude id from
 * another backend (`gpt-5`, `o4-mini`) — to the generic prettifier, then `'—'`.
 */
export function modelLabel(id: string | null, displayName: string | null): string {
  const fallback =
    displayName && displayName.length > 0
      ? displayName
      : (id && genericModelLabel(id)) || '—';

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
