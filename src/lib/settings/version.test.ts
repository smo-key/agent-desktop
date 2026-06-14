import { describe, expect, it } from 'vitest';

// Tests for the pure Settings-footer version label. `package.json` is the single
// source of version truth (scripts/sync-version.sh propagates it into the Tauri /
// Cargo manifests at release time), and Vite injects it at build time. In a dev
// server there is no meaningful release version, so the footer reads "dev".

import { appVersionLabel } from './version';

describe('appVersionLabel', () => {
  it('shows "dev" in development mode regardless of the version string', () => {
    expect(appVersionLabel({ version: '0.1.10', dev: true })).toBe('dev');
    expect(appVersionLabel({ version: '', dev: true })).toBe('dev');
  });

  it('prefixes a real version with "v" in production', () => {
    expect(appVersionLabel({ version: '0.1.10', dev: false })).toBe('v0.1.10');
  });

  it('trims surrounding whitespace from the version', () => {
    expect(appVersionLabel({ version: '  1.2.3  ', dev: false })).toBe('v1.2.3');
  });

  it('falls back to "unknown" for a blank version outside dev mode', () => {
    expect(appVersionLabel({ version: '', dev: false })).toBe('unknown');
    expect(appVersionLabel({ version: '   ', dev: false })).toBe('unknown');
  });
});
