import { beforeEach, describe, expect, it, vi } from 'vitest';

// The What's new dialog store: once-per-version auto-open on launch, driven by
// the `whatsNew.seenVersion` settings slice, and the reopen-any-time entry
// point used by the Settings version button. Scenario-titled after the
// whats-new-dialog spec. The persist helper is mocked; the changelog text and
// running version are injected so the tests never touch the real CHANGELOG.md.

const saveSliceMock = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
vi.mock('$lib/settings/persist', () => ({
  saveSettingsSlice: (...a: unknown[]) => saveSliceMock(...a)
}));

import { WhatsNewStore } from './whatsNewStore.svelte';

const MD = `# Changelog

## 0.4.0 — 2026-09-10

### New

- **Auto update**: installs on restart

## 0.3.2 — 2026-09-01

- **Older**: older note
`;

function store(version = '0.4.0', dev = false, md = MD) {
  return new WhatsNewStore({ version, dev, changelog: md });
}

beforeEach(() => {
  saveSliceMock.mockClear();
});

describe('WhatsNewStore.maybeShowOnLaunch', () => {
  it('first launch after an update', async () => {
    const s = store();
    const opened = await s.maybeShowOnLaunch({ voice: {}, whatsNew: { seenVersion: '0.3.2' } });
    expect(opened).toBe(true);
    expect(s.open).toBe(true);
    expect(s.version).toBe('0.4.0');
    expect(s.groups[0].heading).toBe('New');
    expect(saveSliceMock).toHaveBeenCalledWith('whatsNew', { seenVersion: '0.4.0' });
  });

  it('already seen', async () => {
    const s = store();
    expect(await s.maybeShowOnLaunch({ whatsNew: { seenVersion: '0.4.0' } })).toBe(false);
    expect(s.open).toBe(false);
    expect(saveSliceMock).not.toHaveBeenCalled();
  });

  it('fresh install stays quiet', async () => {
    const s = store();
    expect(await s.maybeShowOnLaunch({})).toBe(false);
    expect(s.open).toBe(false);
    expect(saveSliceMock).toHaveBeenCalledWith('whatsNew', { seenVersion: '0.4.0' });
  });

  it('existing user upgrading into the feature', async () => {
    const s = store();
    expect(await s.maybeShowOnLaunch({ voice: { enabled: true } })).toBe(true);
    expect(s.open).toBe(true);
    expect(saveSliceMock).toHaveBeenCalledWith('whatsNew', { seenVersion: '0.4.0' });
  });

  it('dev build never auto-opens', async () => {
    const s = store('0.4.0', true);
    expect(await s.maybeShowOnLaunch({ whatsNew: { seenVersion: '0.3.2' } })).toBe(false);
    expect(s.open).toBe(false);
    expect(saveSliceMock).not.toHaveBeenCalled();
  });

  it('no notes for the new version', async () => {
    const s = store('0.4.1');
    expect(await s.maybeShowOnLaunch({ whatsNew: { seenVersion: '0.4.0' } })).toBe(false);
    expect(s.open).toBe(false);
    expect(saveSliceMock).toHaveBeenCalledWith('whatsNew', { seenVersion: '0.4.1' });
  });

  it('tolerates a malformed slice', async () => {
    const s = store();
    expect(await s.maybeShowOnLaunch({ whatsNew: 'junk' })).toBe(true);
    expect(await store().maybeShowOnLaunch({ whatsNew: { seenVersion: 7 } })).toBe(true);
  });
});

describe('WhatsNewStore.show / close', () => {
  it('click the version number', () => {
    const s = store();
    s.show();
    expect(s.open).toBe(true);
    expect(s.version).toBe('0.4.0');
    expect(s.groups).toHaveLength(1);
    s.close();
    expect(s.open).toBe(false);
  });

  it('dev build resolves the newest section', () => {
    const s = store('whatever', true);
    s.show();
    expect(s.version).toBe('0.4.0');
    expect(s.groups[0].items[0][0]).toEqual({ kind: 'bold', text: 'Auto update' });
  });

  it('show with no notes opens an empty dialog', () => {
    const s = store('9.9.9');
    s.show();
    expect(s.open).toBe(true);
    expect(s.groups).toEqual([]);
  });
});
