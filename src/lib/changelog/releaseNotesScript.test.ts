import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// scripts/release-notes.mjs is what the release gate runs to produce the GitHub
// Release body. Exercise the real script against the real CHANGELOG.md: a
// released version prints its section; an unknown version exits 1 with an
// actionable message and an EMPTY stdout (so `> RELEASE_NOTES.md` never yields
// a half-written body). release-changelog scenarios.

const script = join(process.cwd(), 'scripts', 'release-notes.mjs');
function run(arg?: string) {
  const r = spawnSync(process.execPath, arg === undefined ? [script] : [script, arg], {
    encoding: 'utf8'
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('scripts/release-notes.mjs', () => {
  it('release notes generated', () => {
    const r = run('v0.3.1');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Suppress console-window flash');
    expect(r.out).not.toContain('## 0.3.1');
    expect(r.out).not.toContain('## 0.3.0');
    // Same body with or without the v prefix.
    expect(run('0.3.1').out).toBe(r.out);
  });

  it('missing section fails before tagging', () => {
    const r = run('9.9.9');
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('no "## 9.9.9" section');
  });

  it('usage error without a version', () => {
    const r = run();
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
  });
});
