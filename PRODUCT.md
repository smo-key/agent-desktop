# Product

## Register

product

## Users

Developers who run **many AI coding agents at once** and want to think about one
thing at a time. They sit at a desk during focused, hours-long sessions, glancing
between live agent terminals, triaging which agent is blocked on them, and keeping
work organized by project. They are power users: keyboard-driven, comfortable with
git and the shell, intolerant of ceremony. The operator's job is to **supervise a
fleet**, not babysit one agent — set objectives, review the work that matters, and
approve the actions an agent can't take alone.

## Product Purpose

Agent Desktop is a Tauri desktop app — a **control room for AI coding agents**. It
turns the operator into a *manager, not a micromanager*: launch and coordinate
multiple agent sessions, watch them from one surface, and respond when one needs
input. Core capabilities: per-project workspaces (color-coded folders with their own
terminals, tasks, and git state), agent orchestration over MCP, full xterm terminals
with file links and a persistent tiling layout, per-project git actions, on-device
voice dictation, and a usage dashboard.

Success looks like an operator keeping six agents productive without dropping the one
that's blocked — the app surfaces **what needs you** and stays quiet about what
doesn't. The metaphor is gentle aerospace: agents are craft you dispatch; you are
mission control. It is calm and inviting equipment, **not** a hacker terminal.

## Brand Personality

**Instrumented, composed, fast.** The UI should feel like trustworthy equipment — a
control room, not a toy: quiet by default, legible at a glance, with sharp accents
only where attention is warranted.

Voice (per `design/README.md`): calm, competent, quietly confident — a great flight
director. Sentence case everywhere except short UPPERCASE mono labels (`AWAITING
REVIEW`, `NOMINAL`). Borrow aerospace/ops vocabulary lightly ("mission", "launch",
"nominal", "standby", "abort") as seasoning, never costume; plain language wins under
any tension ("Approve & continue", not "Authorize sequence"). Terse — one idea per
line. No emoji in product UI.

## Anti-references

- **Generic SaaS dashboards.** No hero-metric templates, no identical card grids, no
  decorative gradient washes.
- **Glassmorphism.** Blur is used lightly (sticky bars, modal scrims) — never as a
  decorative glass-card theme.
- **Neon-on-dark / "hacker terminal" cosplay.** The deep-space dark theme is calm and
  inviting, not a green-on-black matrix or a cyberpunk arcade.
- **Hype and anthropomorphizing.** No "revolutionary", "supercharge", "🚀 blazing
  fast", no "your AI buddy is thinking hard!", no fear/urgency ("ACT NOW", red
  everything). Agents are "the agent", never "the AI" or "the bot".

## Design Principles

1. **Honor the system.** Use the existing tokens (`src/lib/styles/tokens.css` —
   color/space/type/motion); never hard-code a value a token already expresses.
2. **Manage, don't micromanage.** Surface what needs the operator; stay quiet about
   what doesn't. One primary action per surface; everything else ghost/secondary.
3. **Hierarchy through restraint.** Accents earn their rarity — blue is structure,
   orange is "needs you". If orange is everywhere, we've failed; it should read like a
   warm signal flare.
4. **Legible at a glance.** Mono for labels/paths/numerics; clear type contrast;
   light-on-dark text gets extra line-height. The control room is dense-but-calm.
5. **Quiet until it matters.** Motion and color signal state changes (a healthy pulse,
   a focus glow), not decoration. No infinite decorative animation.

## Accessibility & Inclusion

- **WCAG AA contrast.** Body text ≥4.5:1 against the deep-space surfaces; large/UI
  text ≥3:1. Hold the muted `--fg-3` / `--fg-4` ramp honest against the surface it
  sits on — never let "elegant" gray drop below the floor.
- **Reduced motion.** Honor `prefers-reduced-motion`: drop the status pulses and
  segment flashes, show end-states. Motion is never load-bearing for meaning.
- **Never color alone for status.** Every status (nominal / caution / abort / review)
  is paired with an icon, a label, or a shape (a dot plus a word, a badge with text) —
  red/green is never the only signal, for color-blind operators.
- **Full keyboard operability.** Operators are keyboard-driven: every action is
  reachable without a pointer and focus is always visible (the 3px blue `--focus-ring`
  on inputs and keyboard focus). Don't ship an interaction that only works on hover or
  click.
