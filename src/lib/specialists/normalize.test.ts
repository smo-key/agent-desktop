import { describe, expect, it } from 'vitest';
import {
  normalizeSpecialistEntries,
  isSpecialistError,
  type SpecialistError,
} from './specialists.svelte';
import { type Specialist } from './specialists';

// Pure, framework-free tests for the specialists store's normalize core: mapping a
// raw `{ name, content }[]` list (from `specialists_list`) through `parseSpecialist`,
// capturing per-entry parse failures as error entries instead of throwing/dropping.
// Runs under the default (node) Vitest environment — no DOM/Tauri.

const ok = (name: string, description = 'desc') =>
  ['---', `name: ${name}`, `description: ${description}`, '---', 'You are helpful.'].join('\n');

describe('normalizeSpecialistEntries', () => {
  it('parses well-formed entries into Specialist objects', () => {
    const out = normalizeSpecialistEntries([{ name: 'reviewer', content: ok('reviewer') }]);

    expect(out).toHaveLength(1);
    expect(isSpecialistError(out[0])).toBe(false);
    const s = out[0] as Specialist;
    expect(s.name).toBe('reviewer');
    expect(s.description).toBe('desc');
    expect(s.prompt).toBe('You are helpful.');
  });

  it('keeps a malformed entry as an error entry without throwing or dropping others', () => {
    const out = normalizeSpecialistEntries([
      { name: 'good', content: ok('good') },
      { name: 'broken', content: 'no frontmatter at all' },
      { name: 'also-good', content: ok('also-good') },
    ]);

    expect(out).toHaveLength(3);
    expect(isSpecialistError(out[0])).toBe(false);
    expect(isSpecialistError(out[2])).toBe(false);

    const err = out[1];
    expect(isSpecialistError(err)).toBe(true);
    expect((err as SpecialistError).name).toBe('broken');
    expect((err as SpecialistError).error).toMatch(/frontmatter/i);
  });

  it('uses the wire `name` for a broken entry even if its content is unparseable', () => {
    const out = normalizeSpecialistEntries([{ name: 'orphan', content: '---\nnope' }]);

    expect(out).toHaveLength(1);
    const err = out[0] as SpecialistError;
    expect(isSpecialistError(err)).toBe(true);
    expect(err.name).toBe('orphan');
  });

  it('returns an empty list for a non-array input', () => {
    expect(normalizeSpecialistEntries(null)).toEqual([]);
    expect(normalizeSpecialistEntries(undefined)).toEqual([]);
    expect(normalizeSpecialistEntries({} as unknown)).toEqual([]);
  });

  it('skips non-object items and tolerates missing name/content fields', () => {
    const out = normalizeSpecialistEntries([
      null,
      'string',
      42,
      { content: 'no name field, unparseable' },
    ]);

    // null/string/42 are skipped; the bare object becomes an error entry with name ''.
    expect(out).toHaveLength(1);
    const err = out[0] as SpecialistError;
    expect(isSpecialistError(err)).toBe(true);
    expect(err.name).toBe('');
  });
});
