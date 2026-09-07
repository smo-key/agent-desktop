---
name: Agent Desktop
description: A deep-space control room for supervising a fleet of AI coding agents.
colors:
  space-950: "#06080c"
  space-900: "#090c12"
  space-850: "#0d1017"
  space-800: "#11151e"
  space-750: "#161b26"
  space-700: "#1c222f"
  space-650: "#232a39"
  space-600: "#2c3445"
  fg-1: "#eef1f6"
  fg-2: "#b2baca"
  fg-3: "#7b8499"
  fg-4: "#515b71"
  fg-on-accent: "#0a0d13"
  blue-200: "#bbd2ff"
  blue-300: "#8fb4ff"
  blue-500: "#3d7bff"
  blue-600: "#2c63e6"
  blue-700: "#1e49b4"
  orange-300: "#ffb78c"
  orange-500: "#ee7e4d"
  orange-600: "#d9663a"
  clay: "#d97757"
  nominal-500: "#3ccb7f"
  caution-500: "#f0b341"
  abort-500: "#f2564b"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Space Grotesk, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Space Grotesk, Hanken Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.08em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "22px"
  full: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.blue-500}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.blue-600}"
    textColor: "{colors.white}"
  button-energy:
    backgroundColor: "{colors.orange-500}"
    textColor: "{colors.fg-on-accent}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-secondary:
    backgroundColor: "{colors.space-650}"
    textColor: "{colors.fg-1}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-2}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.abort-500}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  input:
    backgroundColor: "{colors.space-800}"
    textColor: "{colors.fg-1}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "11px 13px"
  card:
    backgroundColor: "{colors.space-750}"
    textColor: "{colors.fg-1}"
    rounded: "{rounded.lg}"
    padding: "16px 17px"
  badge:
    backgroundColor: "{colors.blue-500}"
    textColor: "{colors.blue-300}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "4px 9px"
---

# Design System: Agent Desktop

## 1. Overview

**Creative North Star: "The Mission Control Room"**

Agent Desktop looks like trustworthy instrumentation in a dimly-lit operations room.
Surfaces are near-black with a faint cool tint — not pure black, never bluish-purple —
and depth is built almost entirely from **surface lightness plus hairline borders**,
not from heavy shadow. The eye should rest. The operator is supervising six agents at
once across hours-long sessions; the interface stays quiet so that the one thing that
needs attention — an agent awaiting review, a focused input — can speak with a single
warm accent. Most of the screen is neutral; color is a signal, not a decoration.

The system rejects, by name, what most agent-and-AI tooling reaches for: the
**generic SaaS dashboard** (hero-metric templates, identical icon-card grids, gradient
washes), **glassmorphism** as a theme, and the **neon-on-dark "hacker terminal"**
cosplay. The metaphor is gentle aerospace — agents are craft you dispatch; you are
mission control — but it is *seasoning, never costume*: no fake countdowns, no NASA
radio chatter, no starfield slop. Plain language and real data win every time there is
tension. The control room is **dense but calm**: organized into clear cards and rails,
generous in rhythm, precise in its corners.

**Key Characteristics:**
- Deep-space dark theme; near-black `#0d1017` app background with a cool tint.
- Depth from tonal layering + hairlines, not drop shadows.
- Blue is structure; clay-orange is "needs you" and appears rarely.
- Three type roles — geometric display, humanist body, mono telemetry.
- Mono UPPERCASE micro-labels are a brand signature.
- Motion and glow are reserved for *state*, never ornament.

## 2. Colors

A neutral deep-space ramp carries almost everything; two accents (structural blue,
attention orange) and three ops-language status hues do the signaling.

### Primary
- **NASA Blue** (`#3d7bff`, `--blue-500`): the structural, interactive color. Primary
  buttons, focus rings, links, progress bars, active nav, "in-flight" telemetry, the
  inset line on a live card. Darkens to `--blue-600` (`#2c63e6`) on hover and
  `--blue-700` (`#1e49b4`) on press. Light tints (`--blue-200/300`) carry text and
  glyphs on tinted chips.

### Secondary
- **Claude Clay-Orange** (`#ee7e4d`, `--orange-500`; raw brand `--clay #d97757`): the
  energy / attention accent, used *sparingly* — approval moments, "needs you", live
  pulses, the energy button. If orange is everywhere, the system has failed; it should
  read like a warm signal flare against the blue-neutral field.

### Tertiary (status — aerospace ops language)
- **Nominal Green** (`#3ccb7f`, `--nominal-500`): healthy / running.
- **Caution Amber** (`#f0b341`, `--caution-500`): a human action is required; warnings.
- **Abort Red** (`#f2564b`, `--abort-500`): destructive / failed. Rare and meaningful.
  Each status also has a ~13%-alpha tint (`--nominal-tint`, etc.) for backgrounds.

### Neutral
- **Deep-Space Ramp** (`--space-950 #06080c` → `--space-600 #2c3445`): backgrounds and
  surfaces. `--space-850 #0d1017` is the app base; `--space-750 #161b26` is the raised
  card surface; lighter steps are hover/active/input states.
- **Foreground Ramp** (`--fg-1 #eef1f6` primary text → `--fg-4 #515b71` faint):
  `--fg-1` for primary copy and active text, `--fg-2` for secondary/body, `--fg-3` for
  muted metadata, `--fg-4` for the faintest labels and disabled glyphs.
- **Hairlines** (white at 5%→18% alpha, `--line-faint` → `--line-strong`): borders,
  dividers, and the 1px edge on every resting card.

### Named Rules
**The Signal-Flare Rule.** Clay-orange covers a *tiny* fraction of any screen and only
ever means "this needs you" or "this is live." It is never a brand wash, never a
section accent, never decorative. Its rarity is the entire point.

**The Derive-Don't-Invent Rule.** When a new hue is needed, derive it in **OKLCH** from
the existing ramps with a readability floor on dark surfaces. Never hand-pick a new
hex that doesn't descend from `--blue-*`, `--orange-*`, `--space-*`, or a status color.

## 3. Typography

**Display Font:** Space Grotesk (with Hanken Grotesk, system-ui fallback)
**Body Font:** Hanken Grotesk (with system-ui, -apple-system fallback)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo fallback)

**Character:** A geometric, faintly technical display face paired with a warm, highly
legible humanist body — a deliberate contrast-axis pairing, not two near-identical
sans. Mono is the third voice and a brand signature: it carries every label, ID,
timestamp, path, and number so telemetry always reads as telemetry.

### Hierarchy
- **Display** (Space Grotesk 600, 34–56px, line-height 1.08, tracking -0.02em): page
  and hero headings. The token ceiling is `--t-display-xl 56px`; the app rarely needs
  it.
- **Headline** (Space Grotesk 600, 23–28px, line-height 1.08, tracking -0.01em): page
  titles and the control-room header.
- **Title** (Space Grotesk 600, 15–18px, line-height 1.25): lane headings, card names,
  modal titles, top-bar heading.
- **Body** (Hanken Grotesk 400, 14px, line-height 1.5): all UI text and reading. App
  base size is **14px**; light-on-dark gets the extra line-height. Cap reading
  measure at 65–75ch.
- **Label** (JetBrains Mono 500, 10–12px, letter-spacing +0.08–0.1em, UPPERCASE):
  field/section headers, status badges, IDs, runtimes. Numbers use
  `font-variant-numeric: tabular-nums`.

### Named Rules
**The Mono-Label Rule.** Short metadata — section headers, status, callsigns, paths,
counts — is set in JetBrains Mono, UPPERCASE, letter-spaced. This is the one place the
all-caps tracked label is correct; everywhere else is sentence case.

**The Sentence-Case Rule.** Buttons, menus, and headers are sentence case ("Launch
mission", never "Launch Mission"). The mono label is the only exception.

## 4. Elevation

Depth is **tonal first, shadow second.** A resting card is a lighter surface
(`--space-750`) on a darker app (`--space-850`) with a 1px hairline — no drop shadow.
Shadows appear only on things that genuinely float: popovers, menus, modals, dragged
cards. State is expressed with a 1px inset colored line or a focused glow, never by
flooding a surface with color.

### Shadow Vocabulary
- **`--shadow-sm`** (`0 1px 2px rgba(0,0,0,0.4)`): the faintest lift; small poppers.
- **`--shadow-md`** (`0 4px 14px rgba(0,0,0,0.45)`): dropdowns, context menus.
- **`--shadow-lg`** (`0 14px 38px rgba(0,0,0,0.55)`): modals / launch dialog.
- **`--shadow-pop`** (`0 10px 34px rgba(0,0,0,0.62)`): the project select menu.
- **Glows — state only:** `--glow-blue` (focus/active), `--glow-orange` (an agent needs
  you), `--glow-nominal` (healthy pulse), and `--focus-ring` (`0 0 0 3px rgba(61,123,255,0.38)`)
  on every focused input and keyboard-focused control.

### Named Rules
**The Flat-At-Rest Rule.** Surfaces are flat at rest; elevation comes from a lighter
tonal step and a hairline. A drop shadow is a response to *floating* (menu, modal,
drag), and a glow is a response to *state* (focus, live, needs-you) — never decoration.

## 5. Components

### Buttons
- **Shape:** gently rounded (8px, `--r-md`); 9×16px padding, 13px Hanken 600, never
  pill-shaped. `:active` nudges down 1px.
- **Primary:** solid NASA Blue (`--blue-500`) with white text and a 1px top inset
  highlight; hover darkens to `--blue-600`. One primary per surface.
- **Energy:** solid clay-orange (`--orange-500`) with near-black text
  (`--fg-on-accent`); reserved for the approve/"needs you" moment.
- **Secondary:** `--space-650` fill, `--fg-1` text, `--line-default` border.
- **Ghost:** transparent with a hairline border; hover picks up a 5%-white fill and
  text goes to `--fg-1`.
- **Danger:** transparent with an abort-red border and text; hover fills with
  `--abort-tint`. Disabled is `--space-700` on `--fg-4`, `not-allowed`.

### Cards / Containers
- **Corner Style:** 12px (`--r-lg`).
- **Background:** raised surface `--space-750` on the `--space-850` app.
- **Shadow Strategy:** none at rest (see Elevation). Hover lifts to `--space-700`,
  border to `--line-default`, optional `translateY(-1px)`.
- **Border:** 1px `--line-subtle` hairline. State is an inset line or tint, not a flood:
  a **live** card adds `inset 0 0 0 1px rgba(61,123,255,.16)`; a **needs-you / review**
  card adds an orange inset line plus a faint top-edge orange gradient.
- **Internal Padding:** 14–17px.

### Inputs / Fields
- **Style:** translucent fill (`rgba(56,65,85,.35)` / `--space-800`), 1px
  `--line-default`, 8px radius, 14px Hanken.
- **Focus:** border shifts to `--blue-500` and the 3px `--focus-ring` halo appears.
- **Mono label above:** UPPERCASE JetBrains Mono `--fg-3`. Placeholder is `--fg-4`.
- **Send affordance:** a square blue icon-button (`--blue-500`, white glyph), disabled
  to `--space-600` / `--fg-4`.

### Navigation (project panel + rails)
- **Style:** a 230px left rail on `--space-900` with a right hairline. Items are 13px
  Hanken 500 `--fg-2`, 8px radius; hover is a 4%-white fill with text to `--fg-1`.
- **Active:** `--blue-tint` fill with blue text and glyph. An attention dot
  (`--orange-500`, 6px) and a mono count sit at the trailing edge.
- **Section labels:** mono UPPERCASE `--fg-4`.

### Status Badge & Dot (signature)
- **Badge:** mono UPPERCASE pill (`--r-full`) on a ~13%-alpha status tint with the
  status hue as text, leading a 6px dot — e.g. `b-review` = orange tint + `--orange-300`.
- **Dot:** an 8px round status dot; running agents add a soft expanding **pulse**
  (`sdotp`, 1.8s). The dot's color is always paired with a word or badge — color is
  never the only signal.

### Lanes (signature)
The control room is organized into **lanes** — *needs you* (orange), *in flight*
(blue), *done* (neutral) — each a titled row with a mono count, a hairline rule, and a
two-up grid of agent cards. This lane triage is the app's core information
architecture.

## 6. Do's and Don'ts

### Do:
- **Do** reference the tokens in `src/lib/styles/tokens.css` for every color, space,
  radius, and duration. If a token expresses the value, never hard-code it.
- **Do** build depth from tonal surface steps (`--space-850` → `--space-750` →
  `--space-700`) and hairlines (`--line-faint` → `--line-strong`).
- **Do** keep clay-orange to a tiny fraction of the screen, meaning only "needs you" or
  "live" — the Signal-Flare Rule.
- **Do** set labels, IDs, paths, timestamps, and numbers in JetBrains Mono, UPPERCASE
  and letter-spaced for labels, `tabular-nums` for numbers.
- **Do** show every status with an icon/label/shape alongside its color, and keep body
  text at WCAG AA contrast (≥4.5:1) on its surface.
- **Do** make focus always visible with `--focus-ring`, and provide a reduced-motion
  path: drop the pulses and segment flashes, show end-states.

### Don't:
- **Don't** build a **generic SaaS dashboard** — no hero-metric template, no identical
  icon-card grids, no gradient washes.
- **Don't** use **glassmorphism** as a theme; blur is for sticky bars and modal scrims
  only.
- **Don't** drift toward **neon-on-dark "hacker terminal"** — the deep-space theme is
  calm and inviting, not green-on-black or cyberpunk.
- **Don't** flood a card with status color; express state with a 1px inset line, a
  glow, or a tint, plus a badge.
- **Don't** put a drop shadow on a resting surface (Flat-At-Rest Rule), use pill radii
  outside dots/avatars/toggles, or use `border-left`/`border-right` >1px as a colored
  accent stripe.
- **Don't** invent a new hex; derive new hues in OKLCH from the existing ramps with a
  dark-surface readability floor.
- **Don't** title-case buttons, use emoji in product UI, or write fake aerospace
  countdowns / NASA radio chatter.
