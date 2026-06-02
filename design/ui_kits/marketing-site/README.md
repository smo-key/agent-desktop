# Mission Control — Marketing Site UI Kit

A high-fidelity recreation of the **Mission Control public landing page**. A long-scroll
marketing site that puts the brand to work: deep-space dark, NASA-blue structure, a single
warm clay-orange accent, Space Grotesk display type, and the product's own control-room
language.

Open **`index.html`** to view it.

## Sections (top → bottom)

1. **Nav** — sticky, blurred; logo, links, sign-in + primary CTA.
2. **Hero** — eyebrow chip, big balanced headline ("Manage your agents. *Don't
   micromanage them.*"), subhead, dual CTA, and a **product mock** (a faithful CSS
   recreation of the control-room dashboard, tilted in perspective).
3. **Trust strip** — "trusted by" wordmark row (placeholder names).
4. **Values triad** — the brand's three ideas: **Simplicity · Predictability · Capability**.
5. **Manager, not micromanager** — split layout: copy + feature list beside a live
   **approval-card** visual.
6. **How it works** — three numbered steps: Launch → Oversee → Approve.
7. **CTA** — closing call with the logomark and a soft blue glow.
8. **Footer** — brand blurb, link columns, "All systems nominal" status line.

## Files

| File | Role |
|---|---|
| `index.html` | Loads React + Babel + Lucide and the component scripts. |
| `marketing.css` | All landing-page styles (imports the root design tokens). |
| `parts.jsx` | `Icon`, `Nav`, `Hero`, `ProductMock`, `Trust`, `Values`. |
| `parts2.jsx` | `ManagerSplit`, `Steps`, `CTA`, `Footer`. |
| `site.jsx` | Composes the page and renders. |

## Notes

- **Responsive:** single-column below 900px (nav links + mock sidebar hide, grids stack).
- **Links are cosmetic** anchors — this is a visual kit, not a working marketing site.
- Reuses the same button, badge, and card language as the app kit so the two read as one
  brand. The hero's product mock is a static recreation of the live app's dashboard.
- **Icons:** Lucide via CDN, 1.75px stroke (same `Icon` wrapper as the app kit).
