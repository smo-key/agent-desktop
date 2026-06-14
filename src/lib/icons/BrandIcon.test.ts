import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import BrandIcon from './BrandIcon.svelte';

// BrandIcon must render an actual <path> element. The regression was that the
// vendored glyphs are bare `d` path data, so injecting them as `{@html}` produced
// an inert text node (no <path>) and the icons were invisible. We SSR-render the
// component and assert a real `<path d="…">` appears in the output.

describe('BrandIcon', () => {
  it('renders a brand icon as an svg path', () => {
    const { body } = render(BrandIcon, { props: { name: 'cursor' } });
    expect(body).toMatch(/<path\b[^>]*\bd="M/);
  });

  it('renders a utility glyph as an svg path', () => {
    const { body } = render(BrandIcon, { props: { name: 'folder' } });
    expect(body).toMatch(/<path\b[^>]*\bd="M10 4H4/);
  });

  it('falls back to the generic app glyph for an unknown name', () => {
    const { body } = render(BrandIcon, { props: { name: 'totally-unknown-app' } });
    expect(body).toMatch(/<path\b[^>]*\bd="M4 4h6v6/);
  });
});
