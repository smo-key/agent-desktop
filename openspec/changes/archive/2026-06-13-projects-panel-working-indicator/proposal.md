# Projects panel: blue flashing dot when a project is working

## Why

The projects panel (the collapsed rail and the expanded workspace list) showed a
solid orange/red dot next to a project only when one of its agents needed the
user (waiting or errored), and nothing at all otherwise. A project whose agents
were busy working looked identical to one that was completely idle — there was no
at-a-glance signal that work is in flight under a given project. The inbox
already distinguishes "in flight" (a slow blue pulse) from "needs you" (a solid
orange dot); the projects panel should carry the same two-state signal.

## What Changes

- **A working project shows a blue, flashing dot.** When any of a project's live
  agents is actively working (status `working`) and none need the user, the panel
  renders a blue, slowly-flashing "in-flight" dot — the blue counterpart to the
  existing attention dot — in both the collapsed rail and the expanded panel row.
- **Needs-you still wins.** The attention (orange/red) dot takes precedence: a
  project with any waiting/errored agent shows the attention dot, even if other
  agents are working.
- **Idle projects stay blank.** When no live agent needs the user and none is
  working (all finished/idle), the project shows no dot — unchanged.
- **Paused / archived / previewed agents count for neither** indicator, matching
  the existing attention rules.
- The flash honors `prefers-reduced-motion` (no animation), like the inbox's
  in-flight dot.

## Impact

- Affected specs:
  - `projects` → the "Filter The Fleet By Project" requirement is extended to
    describe the working (blue) indicator and the needs-you precedence.
- Code:
  - `src/lib/overview/roster.ts` — new pure `isWorking` predicate (the blue
    counterpart to `needsAttention`).
  - `src/lib/projects/projectRollup.ts` — `ProjectCount` gains a `working` flag
    (`mine.some(isWorking)`) alongside `attn`.
  - `src/lib/projects/ProjectPanel.svelte` — render `.pp-work` / `.pp-rail-work`
    (blue, flashing) in the `{:else if c.working}` branch of both indicators;
    reuses the inbox's flightflash look and honors `prefers-reduced-motion`.
