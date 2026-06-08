// PURE, framework-free helpers for the specialist CREATE/EDIT form. No
// Svelte/Tauri/DOM imports, so it runs under the default (node) Vitest
// environment and is unit-tested in full (specialistForm.test.ts). The form
// component owns the reactive fields + I/O; this module owns the small bits of
// logic worth testing: parsing the comma/space-separated `tools` text input into
// a clean string[] (and back), and assembling a {@link Specialist} from the raw
// form field values.

import type { Specialist } from './specialists';

/**
 * Curated Claude model ids offered by the form's model dropdown. The empty value
 * (`''`) is the "Default (inherit)" option, which OMITS the `model` field from the
 * saved frontmatter (handled by {@link buildSpecialist}). Kept as a small constant
 * so it's easy to update as models change. PURE data — no framework imports.
 */
export const MODEL_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Default (inherit)' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' }
];

/**
 * Curated Claude Code tool names offered by the form's tools multiselect.
 * Selecting none omits `tools` from the frontmatter (the "all tools" default).
 */
export const TOOL_CHOICES: ReadonlyArray<string> = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit'
];

/**
 * Given a saved `model` value, return the option list to show: the curated
 * {@link MODEL_CHOICES} plus, if the saved value is a non-empty id NOT in the
 * curated set (e.g. a hand-edited file), an extra option preserving it verbatim
 * so an in-place edit never silently drops it. PURE.
 */
export function modelOptions(
  current: string | undefined
): ReadonlyArray<{ value: string; label: string }> {
  const cur = (current ?? '').trim();
  if (cur === '' || MODEL_CHOICES.some((m) => m.value === cur)) return MODEL_CHOICES;
  return [...MODEL_CHOICES, { value: cur, label: cur }];
}

/**
 * Given a saved `tools` array, return the checkbox option list to show: the
 * curated {@link TOOL_CHOICES} plus any saved tool NOT in the curated set
 * (appended, in saved order) so hand-edited tools are preserved/selectable. PURE.
 */
export function toolOptions(current: string[] | undefined): string[] {
  const extras = Array.isArray(current)
    ? current.filter((t) => !TOOL_CHOICES.includes(t))
    : [];
  return [...TOOL_CHOICES, ...extras];
}

/**
 * Parse a free-text `tools` input (comma- and/or whitespace-separated, e.g.
 * `Read, Edit Bash`) into a de-duplicated, order-preserving string array. Empty
 * input (or only separators) yields `[]`. Tolerates extra commas/whitespace and
 * surrounding `[ ]` brackets (so pasting a frontmatter value works). Never throws.
 */
export function parseToolsInput(text: string): string[] {
  const raw = typeof text === 'string' ? text : '';
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of inner.split(/[\s,]+/)) {
    const t = tok.trim();
    if (t === '' || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Format a tools array back into the comma-separated text the form input shows
 *  (the inverse of {@link parseToolsInput} for display/seeding an edit). */
export function formatToolsInput(tools: string[] | undefined): string {
  return Array.isArray(tools) ? tools.join(', ') : '';
}

/** The raw, unparsed values straight off the form's bound fields. */
export interface SpecialistFormFields {
  name: string;
  description: string;
  /** Frontmatter `model` override; empty ⇒ omitted. */
  model: string;
  /** Free-text tools input (comma/space separated); empty ⇒ omitted. */
  tools: string;
  /** The markdown body = the system prompt. */
  prompt: string;
}

/**
 * Assemble a {@link Specialist} from the raw form fields: trims the scalar
 * fields, parses `tools` via {@link parseToolsInput}, and OMITS the optional
 * `model`/`tools` when empty (so a blank field never serializes an empty
 * frontmatter line). The prompt body is kept verbatim except for trimming. PURE.
 */
export function buildSpecialist(fields: SpecialistFormFields): Specialist {
  const s: Specialist = {
    name: fields.name.trim(),
    description: fields.description.trim(),
    prompt: fields.prompt.trim()
  };
  const model = fields.model.trim();
  if (model !== '') s.model = model;
  const tools = parseToolsInput(fields.tools);
  if (tools.length > 0) s.tools = tools;
  return s;
}
