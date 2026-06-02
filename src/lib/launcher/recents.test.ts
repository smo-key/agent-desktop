import { describe, expect, it } from 'vitest';
import { addRecent, parseRecents, serializeRecents } from './recents';

// Tests for the PURE recent-folders model that backs the runes `recents` store.
// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// session-launcher spec (Requirement: Recent-Folders Persistence Across
// Restarts) so the coverage gate can match them. The native dialog itself is
// MANUAL; the persistence round-trip is exercised through the pure
// parse/serialize helpers here and wired (untested-headless) in the runes store.

describe('addRecent (recent-folders model)', () => {
  it('A launched folder is added to recents', () => {
    // A folder launched for the first time becomes the most-recent (head) entry.
    expect(addRecent([], '/a')).toEqual(['/a']);
    expect(addRecent(['/a'], '/b')).toEqual(['/b', '/a']);
    expect(addRecent(['/b', '/a'], '/c')).toEqual(['/c', '/b', '/a']);
  });

  it('Re-launching an existing folder does not duplicate it', () => {
    // Re-launching a folder already present moves it to the head rather than
    // adding a second entry — no duplicate absolute paths remain in the list.
    expect(addRecent(['/b', '/a'], '/a')).toEqual(['/a', '/b']);
    expect(addRecent(['/c', '/b', '/a'], '/b')).toEqual(['/b', '/c', '/a']);
    // Re-launching the one already at the head is a no-op (still no duplicate).
    expect(addRecent(['/a', '/b'], '/a')).toEqual(['/a', '/b']);
    // Exactly one occurrence of the moved path survives.
    const out = addRecent(['/x', '/y', '/x'], '/x');
    expect(out.filter((p) => p === '/x')).toHaveLength(1);
  });

  it('Recents survive an app restart', () => {
    // The persisted form round-trips through serialize -> parse unchanged, so a
    // reloaded list (after quit + relaunch) still contains the launched folder
    // in most-recent order. This is the pure half of the restart guarantee; the
    // Rust recents.json read/write is the I/O half (mirrors layout_load/save).
    const list = addRecent(addRecent([], '/proj/a'), '/proj/b');
    const restored = parseRecents(serializeRecents(list));
    expect(restored).toEqual(['/proj/b', '/proj/a']);
  });

  it('caps the list at the most-recent max entries', () => {
    // The list is bounded: pushing past the cap drops the OLDEST (tail) entry,
    // keeping the `max` most-recent folders, newest-first.
    let list: string[] = [];
    for (let i = 0; i < 15; i++) list = addRecent(list, `/p${i}`);
    expect(list).toHaveLength(10); // default cap
    expect(list[0]).toBe('/p14'); // newest at head
    expect(list[9]).toBe('/p5'); // oldest survivor
    expect(list).not.toContain('/p4'); // dropped past the cap

    // An explicit smaller cap is honored.
    const small = addRecent(['/a', '/b', '/c'], '/d', 2);
    expect(small).toEqual(['/d', '/a']);
  });

  it('ignores empty or blank paths and does not mutate the input list', () => {
    const input = ['/a', '/b'];
    // Blank/empty inputs are rejected — the list is returned unchanged.
    expect(addRecent(input, '')).toEqual(['/a', '/b']);
    expect(addRecent(input, '   ')).toEqual(['/a', '/b']);
    // The input array is never mutated (pure).
    expect(input).toEqual(['/a', '/b']);
  });

  it('parseRecents tolerates malformed persisted input', () => {
    // A missing/empty/garbage file yields an empty list rather than throwing.
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('')).toEqual([]);
    expect(parseRecents('not json')).toEqual([]);
    expect(parseRecents('{}')).toEqual([]);
    expect(parseRecents('[1, 2, "/a", "", "/b"]')).toEqual(['/a', '/b']);
    // The documented envelope shape `{ version, recents: [...] }` parses too.
    expect(parseRecents('{"version":1,"recents":["/a","/b"]}')).toEqual([
      '/a',
      '/b'
    ]);
    // De-dupes and caps even when the persisted file is dirty.
    const many = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => `/p${i}`)
    );
    expect(parseRecents(many)).toHaveLength(10);
  });
});
