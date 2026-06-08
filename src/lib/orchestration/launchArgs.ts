// PURE, framework-free composition of the `claude` CLI args that apply a SPECIALIST
// (a native `.claude/agents/<name>.md` subagent) to a freshly-spawned agent pane —
// design D4 of `add-agent-specialists`. No Svelte/Tauri/DOM imports, so the
// load-bearing flag mapping is unit-tested without a live PTY.
//
// The chosen specialist file → launch-args mapping (design D4, spike-confirmed on
// claude 2.1.168):
//   - the body (system prompt) → `--append-system-prompt <body>` (APPEND the persona
//     to Claude Code's default prompt rather than REPLACE it with `--system-prompt`,
//     so the base tool behaviour is kept).
//   - frontmatter `model` (when present + non-empty) → `--model <model>`.
//   - frontmatter `tools` (when present + non-empty) → `--allowedTools <t1> <t2> …`
//     (each tool a SEPARATE arg, matching claude's variadic `--allowedTools`).
//
// The body is omitted from the args only when it is blank (a specialist with no
// system prompt — unusual but valid); otherwise it is always passed verbatim.

import type { Specialist } from '../specialists/specialists';

/**
 * Build the `claude` CLI args that apply specialist `s` to a launch. The returned
 * array is ready to PREPEND to the pane's existing args (it carries only the
 * specialist-derived flags — never `--session-id` / `--settings`, which the spawn
 * override owns). Order: append-system-prompt, then model, then allowedTools.
 *
 * Pure: depends only on `s`; never mutates it.
 */
export function specialistLaunchArgs(s: Specialist): string[] {
  const args: string[] = [];

  // The body IS the system prompt; append it (don't replace claude's default) so
  // base tooling is preserved. A blank body contributes nothing.
  const body = typeof s.prompt === 'string' ? s.prompt.trim() : '';
  if (body !== '') {
    args.push('--append-system-prompt', s.prompt);
  }

  // Optional model override.
  if (typeof s.model === 'string' && s.model.trim() !== '') {
    args.push('--model', s.model);
  }

  // Optional tool allow-list: each tool a separate arg (claude's variadic flag).
  if (Array.isArray(s.tools)) {
    const tools = s.tools.filter((t) => typeof t === 'string' && t.trim() !== '');
    if (tools.length > 0) {
      args.push('--allowedTools', ...tools);
    }
  }

  return args;
}
