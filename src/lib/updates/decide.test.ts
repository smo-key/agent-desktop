import { describe, it, expect } from 'vitest';
import { decideUpdateAction, type UpdateInfo } from './decide';

const update: UpdateInfo = { version: '1.2.3' };

describe('decideUpdateAction', () => {
  // Scenario: Update available → user confirms → download/verify/install.
  it('installs when an update is available and the user confirms', () => {
    expect(decideUpdateAction(update, true)).toEqual({ kind: 'install', update });
  });

  // Scenario: Update available → user declines → no install, continue normally.
  it('does not install when an update is available but the user declines', () => {
    expect(decideUpdateAction(update, false)).toEqual({ kind: 'declined', update });
  });

  // Scenario: No update available → no-op regardless of (irrelevant) confirmation.
  it('is a no-op when no update is available', () => {
    expect(decideUpdateAction(null, false)).toEqual({ kind: 'none' });
    expect(decideUpdateAction(null, true)).toEqual({ kind: 'none' });
  });

  // Scenario: check failed (offline / non-Tauri). The caller swallows the throw
  // and maps it to a `null` update; the decision is the same no-op as "no update",
  // so startup is never blocked and no error is surfaced.
  it('is a no-op when the check failed (mapped to null)', () => {
    expect(decideUpdateAction(null, false)).toEqual({ kind: 'none' });
  });
});
