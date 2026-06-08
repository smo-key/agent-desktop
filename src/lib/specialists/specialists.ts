// PURE, framework-free model for AGENT SPECIALISTS — native Claude Code
// subagents stored as `.claude/agents/<name>.md` files. No Svelte/Tauri/DOM
// imports, so it runs under the default (node) Vitest environment and is
// unit-tested in full (specialists.test.ts). A thin store/IO layer is
// responsible for actually reading/writing the files; this module only owns the
// in-memory model and the (de)serialization + name-validation logic.
//
// FILE FORMAT (Claude Code subagent): a YAML frontmatter block delimited by
// `---` fence lines, followed by the markdown body which IS the system prompt:
//
//   ---
//   name: test-writer
//   description: Writes focused unit tests
//   model: claude-sonnet-4-6
//   tools: [Read, Edit, Bash]
//   ---
//   You are a meticulous test author. ...
//
// YAML LIMITATION: the repo has no YAML dependency, and we deliberately do NOT
// add one. Instead we parse/serialize the SMALL, fixed subset we need:
// `name`/`description`/`model` are plain string scalars and `tools` is a simple
// `[a, b, c]` inline string array. Quoting, block scalars, nested maps, anchors,
// multi-line values, etc. are NOT supported — these subagent files only ever use
// flat scalar frontmatter, so this is sufficient and keeps the surface tiny.

/** A native Claude Code subagent (`.claude/agents/<name>.md`). The frontmatter
 *  fields plus the markdown body (`prompt`), which is the system prompt. */
export interface Specialist {
  /** Filename-safe identifier; the file is `.claude/agents/<name>.md`. */
  name: string;
  /** One-line description of what this specialist is for (frontmatter). */
  description: string;
  /** Optional model override (frontmatter `model`), e.g. `claude-sonnet-4-6`. */
  model?: string;
  /** Optional allow-list of tools (frontmatter `tools`), e.g. `[Read, Edit]`. */
  tools?: string[];
  /** The markdown body = the agent's system prompt. */
  prompt: string;
}

/** Thrown by {@link parseSpecialist} when the input is not a well-formed
 *  subagent file (missing/unterminated frontmatter, or missing required field).
 *  A distinct, catchable error type so callers can surface a clear message. */
export class SpecialistParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecialistParseError';
  }
}

/**
 * Parse a subagent `.md` file into a {@link Specialist}. Tolerant of absent
 * optional fields (they are simply omitted). Throws {@link SpecialistParseError}
 * with a clear message when the frontmatter block is missing/unterminated or a
 * required field (`name`, `description`) is absent — never returns garbage.
 */
export function parseSpecialist(markdown: string): Specialist {
  const text = typeof markdown === 'string' ? markdown : '';
  // The file must OPEN with a `---` fence (allowing a leading BOM / blank lines).
  const opened = text.replace(/^﻿/, '');
  const fenceMatch = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(opened);
  if (!fenceMatch) {
    throw new SpecialistParseError(
      'Missing or unterminated YAML frontmatter: expected a `---` block at the top of the file.'
    );
  }
  const [, frontmatter, bodyRaw] = fenceMatch;
  const fields = parseFrontmatter(frontmatter);

  const name = fields.name;
  if (typeof name !== 'string' || name === '') {
    throw new SpecialistParseError('Frontmatter is missing a required `name`.');
  }
  const description = fields.description;
  if (typeof description !== 'string') {
    throw new SpecialistParseError('Frontmatter is missing a required `description`.');
  }

  const s: Specialist = { name, description, prompt: (bodyRaw ?? '').trim() };
  if (typeof fields.model === 'string' && fields.model !== '') s.model = fields.model;
  const tools = parseToolsArray(fields.tools);
  if (tools) s.tools = tools;
  return s;
}

/**
 * Serialize a {@link Specialist} back into a subagent `.md` file: a `---`-fenced
 * frontmatter block (only the present fields, in a stable order) followed by the
 * prompt body. Round-trips with {@link parseSpecialist}.
 */
export function serializeSpecialist(s: Specialist): string {
  const lines: string[] = ['---', `name: ${s.name}`, `description: ${s.description}`];
  if (typeof s.model === 'string' && s.model !== '') lines.push(`model: ${s.model}`);
  if (Array.isArray(s.tools) && s.tools.length > 0) {
    lines.push(`tools: [${s.tools.join(', ')}]`);
  }
  lines.push('---', s.prompt);
  return lines.join('\n');
}

/** Parse the frontmatter block's `key: value` lines into a flat string map.
 *  Blank lines and `#` comments are ignored; later keys win. Values are taken
 *  verbatim (trimmed) — see the module-level YAML LIMITATION note. */
function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (key !== '') out[key] = value;
  }
  return out;
}

/** Parse a `tools` frontmatter value (`[Read, Edit, Bash]`) into a string array,
 *  or `undefined` when absent/empty. Tolerates surrounding brackets and extra
 *  whitespace; an empty list yields `undefined` so the field is omitted. */
function parseToolsArray(raw: string | undefined): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items = inner
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  return items.length > 0 ? items : undefined;
}

/** The result of {@link validateSpecialistName}: ok, or a human-readable reason. */
export type NameValidation = { ok: true } | { ok: false; reason: string };

/** Allowed characters in a specialist name (also the subagent file's basename). */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a specialist `name` for use as a filename (`.claude/agents/<name>.md`)
 * and for uniqueness within `existingNames`. Rules:
 * - non-empty after trimming;
 * - filename-safe: only `[A-Za-z0-9._-]`, so no path separators or whitespace;
 * - no `..` (path traversal) and no leading dot (no hidden/dotfile names);
 * - unique within `existingNames`, compared CASE-INSENSITIVELY — case-folding
 *   file systems (macOS, Windows) would otherwise collide `Reviewer` with
 *   `reviewer`, so we treat them as duplicates regardless of the host FS.
 */
export function validateSpecialistName(name: string, existingNames: string[]): NameValidation {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') return { ok: false, reason: 'Name cannot be empty.' };
  if (trimmed.startsWith('.')) {
    return { ok: false, reason: 'Name cannot start with a dot.' };
  }
  if (trimmed.includes('..')) {
    return { ok: false, reason: 'Name cannot contain "..".' };
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: 'Name may only contain letters, numbers, dots, dashes, and underscores.',
    };
  }
  const lower = trimmed.toLowerCase();
  if (existingNames.some((existing) => existing.trim().toLowerCase() === lower)) {
    return { ok: false, reason: `A specialist named "${trimmed}" already exists.` };
  }
  return { ok: true };
}
