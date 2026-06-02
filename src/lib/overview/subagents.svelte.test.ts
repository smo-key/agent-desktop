import { describe, expect, it } from 'vitest';
import {
  normalizeSubagents,
  flattenSubagents,
  SubagentsStore,
  type SubagentMap
} from './subagents.svelte';

// Tests for the subagents store's PURE normalization + flatten helpers (Stage 3 of
// agent-overview). Named `*.svelte.test.ts` so vitest compiles the store's `$state`
// rune. The live command/event wiring is MANUAL; here we assert the tolerant
// shaping the store applies to whatever the Rust side (or a bad emit) hands it.

describe('subagents store — normalization', () => {
  it('drops malformed entries and non-array session values', () => {
    const raw = {
      'sess-a': [
        { id: 'a1', parentSession: 'sess-a', label: 'spec:x', status: 'done' },
        { id: '', parentSession: 'sess-a' }, // empty id -> dropped
        { label: 'no-id' }, // no id -> dropped
        null,
        42
      ],
      'sess-b': 'not-an-array', // non-array session value -> skipped
      'sess-c': []
    };
    const map = normalizeSubagents(raw);
    expect(Object.keys(map).sort()).toEqual(['sess-a', 'sess-c']);
    expect(map['sess-a']).toHaveLength(1);
    expect(map['sess-a'][0].id).toBe('a1');
    expect(map['sess-c']).toEqual([]);
  });

  it('a non-object payload yields an empty map', () => {
    expect(normalizeSubagents(null)).toEqual({});
    expect(normalizeSubagents(undefined)).toEqual({});
    expect(normalizeSubagents('nope')).toEqual({});
    expect(normalizeSubagents([1, 2, 3])).toEqual({});
  });

  it('flattens by session id in a stable order for the usage aggregate', () => {
    const map: SubagentMap = {
      'sess-b': [{ id: 'b1', parentSession: 'sess-b' }],
      'sess-a': [
        { id: 'a1', parentSession: 'sess-a' },
        { id: 'a2', parentSession: 'sess-a' }
      ]
    };
    expect(flattenSubagents(map).map((s) => s.id)).toEqual(['a1', 'a2', 'b1']);
  });

  it('store ingest + accessors reflect the normalized map', () => {
    const store = new SubagentsStore();
    expect(store.forSession('sess-a')).toEqual([]);
    expect(store.usageList).toEqual([]);

    store.ingest({
      'sess-a': [{ id: 'a1', parentSession: 'sess-a', usage: { cost: 0.5 } }]
    });
    expect(store.forSession('sess-a')).toHaveLength(1);
    expect(store.usageList.map((s) => s.usage?.cost)).toEqual([0.5]);

    // A bad event payload collapses to an empty map (never throws).
    store.ingest('garbage');
    expect(store.usageList).toEqual([]);
  });
});
