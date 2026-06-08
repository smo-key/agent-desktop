// PURE, framework-free helpers for the specialist CREATE/EDIT form. No
// Svelte/Tauri/DOM imports, so it runs under the default (node) Vitest
// environment and is unit-tested in full (specialistForm.test.ts). The form
// component owns the reactive fields + I/O; this module owns the small bits of
// logic worth testing: parsing the comma/space-separated `tools` text input into
// a clean string[] (and back), and assembling a {@link Specialist} from the raw
// form field values.

import type { Specialist } from './specialists';

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
