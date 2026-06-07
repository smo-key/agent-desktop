import { describe, expect, it } from 'vitest';
import { PROJECT_ICONS, FALLBACK_ICON, iconMarkup } from './projectIcons';

// The action glyphs the agent/project context menus + lifecycle buttons depend on.
// A missing name would silently render the fallback box, so this guards that each
// one resolves to its OWN markup.
const ACTION_ICONS = ['terminal', 'pause', 'play', 'archive', 'rotate-ccw', 'trash-2'];

describe('icon set', () => {
  it('defines every lifecycle action glyph', () => {
    for (const name of ACTION_ICONS) {
      expect(PROJECT_ICONS[name], `missing icon: ${name}`).toBeTruthy();
      // It must be its own glyph, not the fallback (catches a typo'd key).
      expect(iconMarkup(name)).toBe(PROJECT_ICONS[name]);
      expect(iconMarkup(name)).not.toBe(PROJECT_ICONS[FALLBACK_ICON]);
    }
  });

  it('falls back to the box glyph for an unknown name', () => {
    expect(iconMarkup('definitely-not-an-icon')).toBe(PROJECT_ICONS[FALLBACK_ICON]);
  });
});
