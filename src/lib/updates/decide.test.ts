import { describe, it, expect } from 'vitest';
import { decideCheckAction, type UpdateInfo } from './decide';

const update: UpdateInfo = { version: '1.2.3' };

describe('decideCheckAction', () => {
  // Scenario: Background check or download failure is silent — a null result
  // (no update, or a swallowed check throw) never starts a download.
  it('ignores a null check result regardless of current status', () => {
    expect(decideCheckAction(null, { status: 'idle', version: null })).toEqual({
      kind: 'ignore'
    });
    expect(decideCheckAction(null, { status: 'ready', version: '1.2.3' })).toEqual({
      kind: 'ignore'
    });
  });

  // Scenario: Recurring check finds and stages an update — from idle, a found
  // update starts a background download.
  it('downloads a found update when idle', () => {
    expect(decideCheckAction(update, { status: 'idle', version: null })).toEqual({
      kind: 'download',
      update
    });
  });

  // Scenario: An already-staged version is not re-downloaded — the same version
  // that is already downloading or staged is a no-op (no second download).
  it('ignores the same version that is already downloading', () => {
    expect(
      decideCheckAction(update, { status: 'downloading', version: '1.2.3' })
    ).toEqual({ kind: 'ignore' });
  });

  it('ignores the same version that is already staged (ready)', () => {
    expect(decideCheckAction(update, { status: 'ready', version: '1.2.3' })).toEqual({
      kind: 'ignore'
    });
  });

  // A genuinely newer version supersedes an in-flight/staged older one.
  it('downloads a newer version that supersedes a downloading one', () => {
    expect(
      decideCheckAction(update, { status: 'downloading', version: '1.2.2' })
    ).toEqual({ kind: 'download', update });
  });

  it('downloads a newer version that supersedes a staged one', () => {
    expect(
      decideCheckAction(update, { status: 'ready', version: '1.2.2' })
    ).toEqual({ kind: 'download', update });
  });
});
