# Mission Control — Design System

> A desktop app to **control and run AI agents** like Claude. Mission Control turns
> you into a *manager, not a micromanager*: you set objectives, review the work that
> matters, and approve the actions an agent can't take alone — without watching every
> keystroke.

This repository is the brand + product design system. It contains the visual
foundations (color, type, spacing, elevation), brand assets, content guidelines, and
high-fidelity UI kits that let a design agent produce on-brand interfaces and assets
for Mission Control.

**Values that drive every design decision:** Simplicity · Predictability · Capability.

---

## Sources & provenance

This system was authored **from a written brief** — there was no existing codebase,
Figma file, or production app to import from. Everything here is original brand work
built to the brief below. If/when a real codebase or Figma exists, reconcile against it
and update this README with the links.

- **Brief:** "Mission Control: a desktop app to control and run AI agents like Claude.
  Simplifies the experience so the human acts as a manager, not a micromanager."
- **Color direction (from brief):** blue + orange as primaries (NASA / space + Claude),
  *used with restraint*; near-black background; "not a terminal app — make it inviting."
- **External resources provided:** none. *(No Figma links, no GitHub repos, no decks.)*

> ✅ **Fonts are bundled** in `./fonts` (OFL — license files included), wired via
> `@font-face` in `colors_and_type.css`. No font CDN dependency. Iconography uses
> **Lucide** from CDN (see *Iconography*).

---

## The product, in one picture

Mission Control is an **ops/control room for AI agents**. Each agent runs a "mission"
(a task in a repo or workspace). You watch a fleet of agents from a dashboard, drill
into any one to review its activity, and respond to **approval requests** when an agent
hits an action it shouldn't take unilaterally (destructive ops, spend, external side
effects). The metaphor is gentle aerospace: *agents are craft you dispatch into orbit;
you are mission control.* It is calm and inviting, **not** a hacker terminal.

Primary surfaces (see `ui_kits/`):
- **Mission Control app** — the desktop control room (dashboard, mission detail,
  approvals, launch). This is the hero product.
- **Marketing website** — the public landing experience.

---

## Content fundamentals — how Mission Control writes

**Voice:** Calm, competent, and quietly confident — like a great flight director. We are
the steady professional in the room, never breathless or hypey. We respect the user's
intelligence and their time.

**Person & address:** Speak to the user as **"you"**; the product is **"Mission
Control"** or **"we"** sparingly. Agents are referred to by name/callsign ("Orbiter",
"AC-204") and as **"the agent"**, never "the AI" or "the bot".

**Casing:** Sentence case for everything in the UI — buttons, headers, menus
("Launch mission", not "Launch Mission"). Mono **labels** are the one exception: short,
UPPERCASE, letter-spaced metadata tags (`AWAITING REVIEW`, `NOMINAL`, `AC-204`).

**Tone & vocabulary:** Borrow *lightly* from aerospace/ops — "mission", "launch",
"nominal", "standby", "abort", "telemetry", "dispatch". Use it as seasoning, not
costume; never write fake countdowns or cosplay NASA radio chatter. Plain language wins
when there's any tension ("Approve & continue", not "Authorize sequence").

**Stance on control:** Copy constantly reinforces *manager, not micromanager*. We
surface **what needs you** and stay quiet about what doesn't. Approval prompts are
specific and honest about consequences ("This alters live schema and can't be undone
automatically.").

**Length:** Terse. One idea per line. Headlines are short and declarative
("Manage, don't micromanage."). Helper text is one sentence.

**Emoji:** None in product UI. (Marketing may use the logomark as a glyph, never emoji.)

**Examples (good):**
- "Manage, don't micromanage."
- "Orbiter is refactoring the auth module. Nothing needs you right now."
- "Surveyor wants to run a database migration on staging. Approve?"
- "3 agents nominal · 1 awaiting review"
- Empty state: "No missions in flight. Launch one to get started."

**Avoid:**
- Hype ("revolutionary", "supercharge", "🚀 blazing fast")
- Cutesy anthropomorphizing ("Your AI buddy is thinking hard!")
- Fear/urgency ("ACT NOW", red everything)
- Title Case buttons, exclamation overload.

---

## Visual foundations

The full token set lives in **`colors_and_type.css`** (primitives + semantic aliases +
ready-to-use type classes). Highlights:

**Mood / background.** A **deep-space dark theme** is the default and the brand. The base
app background is a near-black with a faint cool/blue tint (`--space-850 #0D1017`), not
pure black and not bluish-purple. Elevation is built mostly from **surface lightness +
subtle hairlines**, not heavy shadows. There are *no* big gradient washes — the closest
thing to a gradient is a soft tint behind an alert, or a focused glow.

**Color.**
- **NASA Blue** (`--blue-500 #3D7BFF`) is the **primary, structural, interactive** color:
  primary buttons, focus rings, links, progress, active nav, "in-flight" telemetry.
- **Claude clay-orange** (`--orange-500 #EE7E4D`) is the **energy / attention accent**,
  used *sparingly* — approval moments, "needs you", live pulses, the tracked agent in the
  logo. If orange is everywhere, we've failed; it should feel like a warm signal flare.
- **Neutrals** are the deep-space ramp (`--space-*`). Most of the UI is neutral.
- **Status** colors speak ops language: nominal green, active blue, review orange,
  caution amber, abort red.
- When you need a new hue, derive it in OKLCH from the existing ramps; don't invent.

**Type.** Three families, clear roles:
- **Space Grotesk** — display & headings (the "voice"; geometric, technical, a little
  characterful). Weights 500/600, tight tracking (`-0.02em`).
- **Hanken Grotesk** — body, UI text, long reading (neutral, warm, high legibility).
  App UI base size is **14px**; marketing reads larger.
- **JetBrains Mono** — telemetry, labels, IDs, timestamps, code. Mono is a *brand
  signature*: uppercase, letter-spaced (`+0.08em`) for labels; tabular-nums for numbers.

**Spacing.** 4px base grid (`--s-1`=4 … `--s-16`=64). Generous but not airy; the control
room is dense-but-calm, organized into clear cards and rails.

**Radii.** Precise, controlled — **not** pill-heavy. Cards `--r-lg 12px`, buttons/inputs
`--r-md 8px`, small chips `--r-sm 6px`; `--r-full` only for status dots, avatars, and
toggles.

**Borders.** Hairlines are white at low opacity (`0.05 → 0.18`). Cards = 1px subtle
hairline on a raised surface. A "live" card adds a 1px inset blue line; an approval card
adds an orange glow.

**Elevation / shadows.** Subtle. `--shadow-md/-lg` for popovers, menus, modals, and
dragged cards only. Resting cards use surface lightness + hairline, *not* a drop shadow.

**Glows.** Reserved for *state*, not decoration: `--glow-blue` (focus/active),
`--glow-orange` (an agent needs you), `--glow-nominal` (healthy pulse). Status dots on
running agents **pulse** softly; everything else is still.

**Hover / press.**
- *Hover:* surfaces lighten one step (`--space-650`), or a ghost element picks up a faint
  `rgba(255,255,255,.05)` fill and text goes to `--fg-1`. Primary buttons darken to
  `--blue-600`.
- *Press:* darken one more step (`--blue-700`) and/or a 1px nudge down; subtle scale
  (`0.98`) is OK on buttons. No big bouncy springs.

**Focus.** Always visible: `--focus-ring` (3px blue halo) on inputs and keyboard focus.

**Motion.** Quiet and quick. Durations `120–360ms`, easing `--ease-out`
(`cubic-bezier(.22,1,.36,1)`). Fades and short slides; **no** infinite decorative
animation except the gentle status pulse. Reduced-motion: show end-state, drop pulses.

**Transparency / blur.** Used lightly: tinted status backgrounds
(`--blue-tint`, `--orange-tint` at ~12% alpha), and an optional `backdrop-filter` blur on
sticky top bars / modal scrims. Not a glassmorphism theme.

**Imagery.** Cool, deep, photographic-or-abstract space/aerospace feel when imagery is
needed — dark, low-noise, blue-leaning, with the occasional warm highlight. Prefer
restraint and real assets over decorative SVG. **Never** auto-generate spacey
illustrations or starfield slop; a single calm hero image beats a busy collage.

**Cards.** Raised surface (`--space-750`) + 1px subtle hairline + `--r-lg` corners +
interior padding `14–17px`. State is shown via a colored inset line or glow, a status
badge, and a mono telemetry footer — not via color-flooding the whole card.

See the **Design System** tab for live specimens of every token and component.

---

## Iconography

- **System:** **Lucide** (open-source, MIT). Clean line icons, consistent **1.75px**
  stroke on a 24px grid — technical but friendly, matching the "inviting control room"
  tone. No filled/duotone icon sets; line only.
- **Delivery:** loaded from CDN in previews/kits:
  `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.js`, then `lucide.createIcons({attrs:{'stroke-width':1.75}})`
  with `<i data-lucide="rocket"></i>`. For production, install the `lucide` package.
- **Common glyphs:** `rocket` (launch), `git-branch`, `circle-check` (approve),
  `octagon-x` (abort), `pause`, `radar` (monitor), `list-checks` (tasks),
  `shield-check` (trusted), `clock` (runtime), `layout-dashboard`, `bell`, `settings`.
- **Color:** icons inherit text color (`--fg-2` default, `--fg-1` when active/hovered,
  semantic colors when status-bound). Icon size in UI: 16–20px; touch/hit target ≥ 36px.
- **Emoji:** not used as iconography anywhere in product UI.
- **Unicode glyphs:** avoid as icons; the one accepted "glyph" is a `●` status dot (and we
  prefer a styled `<span>` dot over the character).
- **Brand mark vs. icons:** the **logomark** (`assets/logomark.svg`) is a brand asset, not
  an icon — don't drop it inline in icon rows except as an agent avatar.

> Substitution flag: Lucide is a *chosen* set for this net-new brand, not a recreation of
> an existing product's icons. If a real Mission Control app later ships its own icon set,
> replace Lucide and update this section.

---

## Index — what's in this repo

| Path | What it is |
|---|---|
| `README.md` | This file — overview, content & visual foundations, iconography, index. |
| `colors_and_type.css` | All design tokens: color primitives + semantic aliases, type scale & classes, spacing, radii, elevation/glows, motion. **Start here.** |
| `SKILL.md` | Agent-Skill manifest so this system can be used directly in Claude Code. |
| `fonts/` | Bundled variable fonts (Space Grotesk, Hanken Grotesk, JetBrains Mono) + OFL licenses. |
| `assets/` | Brand assets: `logomark.svg` (+ usages). |
| `preview/` | Small specimen cards that populate the **Design System** tab (type, color, spacing, components, brand). Not for shipping. |
| `ui_kits/mission-control-app/` | Hi-fi recreation of the desktop control-room app — README + `index.html` + JSX components. |
| `ui_kits/marketing-site/` | Hi-fi landing page kit — README + `index.html` + JSX components. |
| `scraps/` | Working screenshots (ignore). |

**To design something on-brand:** read `colors_and_type.css`, skim this README's
*Content* + *Visual* sections, then pull components from the relevant `ui_kits/` kit and
copy assets out of `assets/`.

---

## Caveats

- **Fonts are bundled offline** in `./fonts` as variable TTFs (one file per family,
  OFL-licensed, license files included) and loaded via `@font-face` in
  `colors_and_type.css` — no CDN dependency.
- **Icons** are Lucide via CDN (see Iconography). If you need icons offline too, install
  the `lucide` npm package or vendor the SVGs — just ask.
- This is **original brand work to a brief** — no existing app/Figma was provided. Treat
  the app's information architecture (a single lane-based control room — needs attention /
  completed / in flight) as a proposal to validate against the real product.
