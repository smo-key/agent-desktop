---
name: mission-control-design
description: Use this skill to generate well-branded interfaces and assets for Mission Control (a desktop app for managing AI agents), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out
and create static HTML files for the user to view. If working on production code, you can
copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to
build or design, ask some questions, and act as an expert designer who outputs HTML
artifacts _or_ production code, depending on the need.

## Where things are

- `README.md` — the brand bible: product context, content/voice rules, visual
  foundations, iconography, and a file index. **Read this first.**
- `colors_and_type.css` — all design tokens (color, type scale + classes, spacing, radii,
  elevation/glows, motion). Import it or copy the values.
- `assets/logomark.svg` — the orbital roundel logomark.
- `preview/` — small specimen cards for every token & component (reference, not shipping).
- `ui_kits/mission-control-app/` — the desktop control-room app: factored React/JSX
  components you can lift (Sidebar, MissionCard, ApprovalRow, MissionDetail, LaunchModal,
  plus `ui.jsx` primitives and `app.css`).
- `ui_kits/marketing-site/` — the landing page: Nav, Hero, ProductMock, Values, etc.

## The one-paragraph brand

Mission Control is a calm, capable control room for AI agents — *manager, not
micromanager*. Deep near-black space backgrounds, **NASA blue** for structure and
interaction, a single warm **clay-orange** accent used sparingly for "needs you" / live
moments. **Space Grotesk** for display, **Hanken Grotesk** for reading, **JetBrains Mono**
for telemetry/labels. **Lucide** icons at 1.75px. Sentence case everywhere except
UPPERCASE mono labels. Quiet motion, subtle glows for state, precise (not pill-heavy)
radii. Values: Simplicity, Predictability, Capability.

## Quick start for a new artifact

1. Copy `assets/logomark.svg` and link/inline `colors_and_type.css`.
2. Pull the relevant components from a `ui_kit` (or copy the patterns).
3. Keep the deep-space dark theme; let blue do the work and orange be the rare signal.
4. Fonts are bundled in `fonts/` (loaded via `@font-face` in `colors_and_type.css`) — just
   import the CSS. Load Lucide for icons
   (`https://unpkg.com/lucide@0.460.0/dist/umd/lucide.js`, then `lucide.createIcons()`).
