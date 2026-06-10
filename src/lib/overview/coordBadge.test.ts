import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PROJECT_ICONS, FALLBACK_ICON, iconMarkup } from '../icons/projectIcons';

// The "coordinated" attribution badge on a roster row (in `Inbox.svelte`'s
// `sessionRow` snippet) must be an ICON-ONLY compass chip: a single `compass`
// glyph, NO "coordinated" text label, and NEVER a `git-branch` icon (which would
// wrongly imply a git branch). Hovering must still surface the coordinator
// tooltip. `Inbox.svelte` has no component-render harness in this repo, so we
// guard the invariants by isolating the badge's markup branch from the source.
const INBOX_SRC = readFileSync(
  fileURLToPath(new URL('./Inbox.svelte', import.meta.url)),
  'utf8'
);

/**
 * The markup of the coordinated-agent badge: the `{:else if r.coordinatorPaneId}`
 * branch up to the next `{:else`/`{/if}`. Isolating it keeps these assertions off
 * the *coordinator's own* badge (the `bot` chip) and the specialist chip.
 */
function coordinatedBadgeBranch(): string {
  const start = INBOX_SRC.indexOf('{:else if r.coordinatorPaneId}');
  expect(start, 'coordinated-agent badge branch not found in Inbox.svelte').toBeGreaterThan(-1);
  const rest = INBOX_SRC.slice(start + '{:else if r.coordinatorPaneId}'.length);
  const end = rest.search(/\{:else|\{\/if\}/);
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('coordinated-agent badge', () => {
  it('renders a single compass icon, never a git-branch icon', () => {
    const branch = coordinatedBadgeBranch();
    expect(branch).toContain('name="compass"');
    expect(branch).not.toContain('name="git-branch"');
  });

  it('has no "coordinated" text label (icon-only chip)', () => {
    const branch = coordinatedBadgeBranch();
    expect(branch).not.toMatch(/coordinated/i);
  });

  it('preserves the coordinator tooltip on hover', () => {
    const branch = coordinatedBadgeBranch();
    expect(branch).toContain("use:tooltip={'Spawned by the project coordinator'}");
  });

  it('uses the orange coord-badge chip styling', () => {
    const branch = coordinatedBadgeBranch();
    expect(branch).toContain('coord-badge');
  });

  it('resolves the compass glyph to its own markup (not the fallback)', () => {
    // The icon-only badge has no text fallback, so the glyph must actually exist.
    expect(PROJECT_ICONS['compass'], 'missing compass glyph').toBeTruthy();
    expect(iconMarkup('compass')).toBe(PROJECT_ICONS['compass']);
    expect(iconMarkup('compass')).not.toBe(PROJECT_ICONS[FALLBACK_ICON]);
  });
});
