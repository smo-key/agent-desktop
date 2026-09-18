import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  isPrerelease,
  isMsiCompatibleVersion,
  compareVersions,
  highestTag,
  channelForBranch,
  decideRelease
} from './version-compare.mjs';

describe('parseVersion', () => {
  it('parses a plain version', () => {
    expect(parseVersion('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: []
    });
  });

  it('tolerates a leading v and discards build metadata', () => {
    expect(parseVersion('v0.4.0-beta.1+sha.abc')).toEqual({
      major: 0,
      minor: 4,
      patch: 0,
      prerelease: ['beta', '1']
    });
  });

  it('rejects things that are not semver', () => {
    for (const bad of ['', 'v', '1.2', '1.2.3.4', 'latest', 'v-old', '01.2.3']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe('isPrerelease', () => {
  it('distinguishes prereleases from stable versions', () => {
    expect(isPrerelease('0.4.0-beta.1')).toBe(true);
    expect(isPrerelease('v0.4.0-rc.1')).toBe(true);
    expect(isPrerelease('0.4.0')).toBe(false);
    expect(isPrerelease('nonsense')).toBe(false);
  });
});

describe('isMsiCompatibleVersion', () => {
  // `tauri build` rejects a non-numeric prerelease identifier for the msi target,
  // but only after compiling the whole binary — so the gate has to catch it.
  it('accepts a plain version', () => {
    expect(isMsiCompatibleVersion('0.4.0')).toBe(true);
  });

  it('accepts a single numeric prerelease identifier', () => {
    expect(isMsiCompatibleVersion('0.4.0-1')).toBe(true);
    expect(isMsiCompatibleVersion('0.4.0-65535')).toBe(true);
  });

  it('rejects a dotted or alphabetic prerelease identifier', () => {
    // The literal version that failed the Windows leg.
    expect(isMsiCompatibleVersion('0.4.0-beta.1')).toBe(false);
    expect(isMsiCompatibleVersion('0.4.0-beta')).toBe(false);
    expect(isMsiCompatibleVersion('0.4.0-rc.1')).toBe(false);
    expect(isMsiCompatibleVersion('0.4.0-1.2')).toBe(false);
  });

  it('rejects a prerelease identifier above the 16-bit ceiling', () => {
    expect(isMsiCompatibleVersion('0.4.0-65536')).toBe(false);
  });

  it('rejects an unparseable version', () => {
    expect(isMsiCompatibleVersion('latest')).toBe(false);
  });
});

describe('compareVersions', () => {
  // SemVer 2.0.0 §11 precedence, including the prerelease rules the gate's old
  // truncating shell compare could not express.
  const cases = [
    ['1.0.0', '2.0.0', -1],
    ['2.0.0', '2.1.0', -1],
    ['2.1.0', '2.1.1', -1],
    ['1.0.0', '1.0.0', 0],
    // a prerelease ranks BELOW its release
    ['1.0.0-alpha', '1.0.0', -1],
    ['0.4.0', '0.4.0-beta.3', 1],
    // the exact pair the old compare called equal
    ['0.4.0-beta.2', '0.4.0-beta.1', 1],
    // §11.4 ordering
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-alpha.beta', '1.0.0-beta', -1],
    ['1.0.0-beta', '1.0.0-beta.2', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-beta.11', '1.0.0-rc.1', -1],
    // build metadata takes no part in precedence
    ['1.0.0+build.1', '1.0.0+build.9', 0]
  ];
  for (const [a, b, want] of cases) {
    it(`orders ${a} ${want === 0 ? '==' : want < 0 ? '<' : '>'} ${b}`, () => {
      expect(compareVersions(a, b)).toBe(want);
      expect(compareVersions(b, a)).toBe(want === 0 ? 0 : -want);
    });
  }

  it('returns null rather than guessing for unparseable input', () => {
    expect(compareVersions('1.0.0', 'latest')).toBeNull();
    expect(compareVersions('nope', '1.0.0')).toBeNull();
  });
});

describe('highestTag', () => {
  const tags = ['v0.3.0', 'v0.3.2', 'v0.4.0-1', 'v0.4.0-10', 'v-old', 'nightly'];

  it('excludes prereleases for the stable baseline', () => {
    expect(highestTag(tags, { prerelease: 'exclude' })).toBe('v0.3.2');
  });

  it('considers every lane for the beta baseline', () => {
    expect(highestTag(tags, { prerelease: 'any' })).toBe('v0.4.0-10');
  });

  it('considers only prereleases when asked', () => {
    expect(highestTag(tags, { prerelease: 'only' })).toBe('v0.4.0-10');
  });

  it('ignores unparseable tags instead of letting them win', () => {
    expect(highestTag(['v-old', 'nightly', 'v1.0.0'])).toBe('v1.0.0');
  });

  it('returns null when nothing qualifies', () => {
    expect(highestTag([], { prerelease: 'exclude' })).toBeNull();
    expect(highestTag(['v0.4.0-1'], { prerelease: 'exclude' })).toBeNull();
  });
});

describe('channelForBranch', () => {
  it('maps the two release branches and nothing else', () => {
    expect(channelForBranch('main')).toBe('stable');
    expect(channelForBranch('beta')).toBe('beta');
    expect(channelForBranch('feature/x')).toBeNull();
    expect(channelForBranch('')).toBeNull();
  });
});

describe('decideRelease', () => {
  it('Consecutive betas both release', () => {
    const d = decideRelease({
      version: '0.4.0-2',
      channel: 'beta',
      tags: ['v0.3.2', 'v0.4.0-1']
    });
    expect(d.shouldRelease).toBe(true);
    expect(d.tag).toBe('v0.4.0-2');
    expect(d.baseline).toBe('v0.4.0-1');
  });

  it('refuses a prerelease the Windows MSI bundler would reject', () => {
    // Caught in the gate in seconds, instead of ~12 minutes into the Windows leg
    // with macOS and both Linux targets already built and uploaded.
    const d = decideRelease({ version: '0.4.0-beta.1', channel: 'beta', tags: ['v0.3.2'] });
    expect(d.shouldRelease).toBe(false);
    expect(d.reason).toMatch(/MSI bundler rejects/);
  });

  it('Stable lane ignores prerelease tags', () => {
    const d = decideRelease({
      version: '0.4.0',
      channel: 'stable',
      tags: ['v0.3.2', 'v0.4.0-5']
    });
    expect(d.shouldRelease).toBe(true);
    expect(d.baseline).toBe('v0.3.2');
  });

  it('Beta must outrank the newest stable', () => {
    const d = decideRelease({
      version: '0.4.0-9',
      channel: 'beta',
      tags: ['v0.3.2', 'v0.5.0', 'v0.4.0-8']
    });
    expect(d.shouldRelease).toBe(false);
    expect(d.baseline).toBe('v0.5.0');
  });

  it('Version form must match the branch', () => {
    const onMain = decideRelease({
      version: '0.4.0-1',
      channel: 'stable',
      tags: ['v0.3.2']
    });
    expect(onMain.shouldRelease).toBe(false);
    expect(onMain.reason).toMatch(/prerelease/);

    const onBeta = decideRelease({ version: '0.4.0', channel: 'beta', tags: ['v0.3.2'] });
    expect(onBeta.shouldRelease).toBe(false);
    expect(onBeta.reason).toMatch(/prerelease suffix/);
  });

  it('is idempotent once the tag exists', () => {
    const d = decideRelease({
      version: '0.4.0-1',
      channel: 'beta',
      tags: ['v0.3.2', 'v0.4.0-1']
    });
    expect(d.shouldRelease).toBe(false);
    expect(d.reason).toMatch(/already exists/);
    // Reported separately so the workflow's force_publish override can refuse to
    // overrule "already shipped" while still overruling "no version bump".
    expect(d.tagExists).toBe(true);
  });

  it('reports tagExists=false for every other refusal', () => {
    const noBump = decideRelease({ version: '0.3.2', channel: 'stable', tags: ['v0.4.0'] });
    expect(noBump.tagExists).toBe(false);
    const mismatch = decideRelease({ version: '0.4.0', channel: 'beta', tags: [] });
    expect(mismatch.tagExists).toBe(false);
    const junk = decideRelease({ version: 'latest', channel: 'stable', tags: [] });
    expect(junk.tagExists).toBe(false);
  });

  it('releases the first version when no tags exist yet', () => {
    const d = decideRelease({ version: '0.1.0', channel: 'stable', tags: [] });
    expect(d.shouldRelease).toBe(true);
    expect(d.baseline).toBeNull();
  });

  it('does not release when the version equals the baseline', () => {
    const d = decideRelease({ version: '0.3.2', channel: 'stable', tags: ['v0.3.2x', 'v0.3.2'] });
    expect(d.shouldRelease).toBe(false);
  });

  it('refuses an unparseable version instead of releasing it', () => {
    const d = decideRelease({ version: 'latest', channel: 'stable', tags: [] });
    expect(d.shouldRelease).toBe(false);
    expect(d.reason).toMatch(/not a valid semver/);
  });
});
