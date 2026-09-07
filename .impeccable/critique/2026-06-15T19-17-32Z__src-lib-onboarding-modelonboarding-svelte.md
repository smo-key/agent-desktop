---
target: src/lib/onboarding/ModelOnboarding.svelte
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-06-15T19-17-32Z
slug: src-lib-onboarding-modelonboarding-svelte
---
# Critique — ModelOnboarding.svelte

First-run, full-screen gate that asks for a one-time on-device model download (voice + smart titles). Register: product / onboarding flow.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Determinate bar + %, but bare percent — no bytes/ETA, and the model list vanishes mid-download |
| 2 | Match System / Real World | 2 | "Skip for now" implies it returns; it dismisses permanently (persisted seen) |
| 3 | User Control & Freedom | 2 | No cancel once downloading; no later-path surfaced |
| 4 | Consistency & Standards | 2 | Primary button dark text vs app's white-on-blue; off-scale radii/sizes; 120ms ease vs token motion |
| 5 | Error Prevention | 3 | Solid re-entrancy guard; skip is benign (voice fetches on demand later) |
| 6 | Recognition Rather Than Recall | 3 | Lists models + sizes; doesn't say where to get them later |
| 7 | Flexibility & Efficiency | 3 | autofocus + Enter-to-download is good for power users |
| 8 | Aesthetic & Minimalist | 3 | Clean and calm, but anonymous — misses the instrumented personality |
| 9 | Error Recovery | 3 | role=alert + Retry is good; message is generic |
| 10 | Help & Documentation | 1 | None — no explainer, no later-path |
| Total | | 25/40 | Acceptable |

## Anti-Patterns Verdict

LLM: Not slop. Strong a11y scaffolding (dialog semantics, aria-live, role=alert, autofocus, Enter-to-submit) and a correct drag-region fix. Real failure mode is product design-system drift: hard-coded #ff8a8d, 14px/9px/999px radii, 13.5/12.5px off-scale type, 120ms ease instead of --dur-fast/--ease-out.

Detector: 1 warning — layout-transition at line 265 (transition: width on .prog-fill). Fix with transform: scaleX().

Browser overlay: skipped — gate renders only behind first-run state and the web dev server's dependency tree is currently broken; source + detector only.

## What's Working
- Accessibility is a genuine strength (dialog semantics, live regions, autofocus, Enter-to-submit). Contrast passes AA (--fg-3 on --bg-surface ≈ 4.78:1).
- The drag-region fix is correct and well-commented.
- Honest, calm copy with full transparency (lists what's fetched, sizes, total).

## Priority Issues
- [P1] Design-system drift: hard-coded color, off-scale radii/type, 120ms ease bypass tokens. Fix: map to --abort-*, --r-*, --t-*, --dur-fast/--ease-out. (/impeccable polish)
- [P1] No reduced-motion path (committed a11y rule) + flagged width animation. Fix: @media reduce + transform: scaleX(). (/impeccable animate)
- [P1] Primary button off-standard (dark text on blue, 9px) vs app's white-on-blue at --r-md. Fix: match .btn-primary. (/impeccable polish)
- [P2] High-stakes download is an emotional valley: bare percent, list vanishes; stall looks like progress. Fix: keep list, surface received/total bytes. (/impeccable harden)
- [P2] "Skip for now" hides its consequence (permanent dismiss; no later-path). Fix: truthful helper line. (/impeccable clarify)

## Persona Red Flags
- Jordan (first-timer): no answer to "what are these / where do they go / does skip break voice?" No breadcrumb after Skip.
- Sam (a11y): strong baseline; gaps are no prefers-reduced-motion and error conveyed largely by color (mitigated by role=alert, but no icon).
- Casey (slow connection): bare percent, no byte/ETA on a large download — "is it stuck?" valley.

## Minor Observations
- Title is the product name; the task ("Set up on-device models") is buried in the subtitle yet is already the aria-label.
- Empty-missing degraded state shows a Download button with no list — off framing.
- Model sizes are sans; brand signature is mono + tabular-nums for numerics.
