import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pinManifestToTag } from './beta-manifest.mjs';

const BASE = 'https://github.com/smo-key/agent-desktop/releases';

function manifest(urls) {
  return {
    version: '0.4.0-1',
    pub_date: '2026-09-18T17:00:00Z',
    platforms: Object.fromEntries(
      Object.entries(urls).map(([k, url]) => [k, { signature: `sig-${k}`, url }])
    )
  };
}

describe('the module itself', () => {
  it('starts with no shebang', () => {
    // Windows CI checks out with CRLF. `#!/usr/bin/env node\r` makes the loader
    // emit invalid JS, so THIS SUITE fails to load at all — which is how it
    // failed: 150 files green, this one `SyntaxError: Invalid or unexpected
    // token`, on Windows only. The file is always run as `node <path>`.
    const src = readFileSync(new URL('./beta-manifest.mjs', import.meta.url), 'utf8');
    expect(src.startsWith('#!')).toBe(false);
  });
});

describe('pinManifestToTag', () => {
  it('pins a releases/latest URL to the release tag', () => {
    // The exact shape tauri-action emits, and the exact pair verified against the
    // real v0.4.0-1 release: the `latest` form 404s, the tagged form is 200.
    const m = manifest({
      'windows-x86_64-nsis': `${BASE}/latest/download/Agent.Desktop_0.4.0-1_x64-setup.exe`
    });
    const { manifest: out, rewritten } = pinManifestToTag(m, 'v0.4.0-1');
    expect(rewritten).toBe(1);
    expect(out.platforms['windows-x86_64-nsis'].url).toBe(
      `${BASE}/download/v0.4.0-1/Agent.Desktop_0.4.0-1_x64-setup.exe`
    );
  });

  it('rewrites every platform entry', () => {
    const m = manifest({
      'darwin-aarch64': `${BASE}/latest/download/a.app.tar.gz`,
      'linux-x86_64-deb': `${BASE}/latest/download/b.deb`,
      'windows-x86_64-msi': `${BASE}/latest/download/c.msi`
    });
    const { manifest: out, rewritten } = pinManifestToTag(m, 'v0.4.0-2');
    expect(rewritten).toBe(3);
    for (const p of Object.values(out.platforms)) {
      expect(p.url).toContain('/releases/download/v0.4.0-2/');
      expect(p.url).not.toContain('/releases/latest/');
    }
  });

  it('preserves the signature and every other field', () => {
    const m = manifest({ 'darwin-aarch64': `${BASE}/latest/download/a.tar.gz` });
    const { manifest: out } = pinManifestToTag(m, 'v0.4.0-1');
    expect(out.version).toBe('0.4.0-1');
    expect(out.pub_date).toBe('2026-09-18T17:00:00Z');
    // The signature is what the updater verifies the bundle against; losing it
    // would make every beta update fail signature verification.
    expect(out.platforms['darwin-aarch64'].signature).toBe('sig-darwin-aarch64');
  });

  it('does not mutate the input manifest', () => {
    const m = manifest({ 'darwin-aarch64': `${BASE}/latest/download/a.tar.gz` });
    pinManifestToTag(m, 'v0.4.0-1');
    expect(m.platforms['darwin-aarch64'].url).toContain('/releases/latest/download/');
  });

  it('is idempotent — an already-pinned URL is left alone', () => {
    const m = manifest({ 'darwin-aarch64': `${BASE}/download/v0.4.0-1/a.tar.gz` });
    const { manifest: out, rewritten, skipped } = pinManifestToTag(m, 'v0.4.0-1');
    expect(rewritten).toBe(0);
    expect(skipped).toBe(1);
    expect(out.platforms['darwin-aarch64'].url).toBe(`${BASE}/download/v0.4.0-1/a.tar.gz`);
  });

  it('passes through an entry with no usable url instead of guessing', () => {
    const m = { version: '0.4.0-1', platforms: { 'darwin-aarch64': { signature: 's' } } };
    const { manifest: out, skipped } = pinManifestToTag(m, 'v0.4.0-1');
    expect(skipped).toBe(1);
    expect(out.platforms['darwin-aarch64']).toEqual({ signature: 's' });
  });

  it('rejects a manifest with no platforms, and a missing tag', () => {
    expect(() => pinManifestToTag({}, 'v1.0.0')).toThrow(/platforms/);
    expect(() => pinManifestToTag(null, 'v1.0.0')).toThrow(/object/);
    expect(() => pinManifestToTag(manifest({}), '')).toThrow(/tag/);
  });
});
