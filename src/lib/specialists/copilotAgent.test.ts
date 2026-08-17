import { describe, expect, it } from 'vitest';
import {
  copilotAgentFile,
  copilotAgentName,
  copilotSpecialistArgs,
  COPILOT_AGENT_PREFIX
} from './copilotAgent';
import type { Specialist } from './specialists';

const spec = (over: Partial<Specialist> = {}): Specialist =>
  ({
    name: 'code-reviewer',
    description: 'Reviews diffs',
    model: 'gpt-5',
    tools: ['Bash', 'Edit'],
    prompt: 'You are a meticulous reviewer.',
    ...over
  }) as Specialist;

describe('copilot custom-agent translation (agent-specialists)', () => {
  it('Copilot specialist launch via translated custom agent', () => {
    // The generated name is app-prefixed and filename-safe; the file carries
    // frontmatter (name/description/model) with the persona as the body; the
    // launch args apply it via --agent.
    const name = copilotAgentName('Code Reviewer!');
    expect(name).toBe(`${COPILOT_AGENT_PREFIX}code-reviewer`);
    const file = copilotAgentFile(spec());
    expect(file).toContain('name: "code-reviewer"');
    expect(file).toContain('description: "Reviews diffs"');
    expect(file).toContain('model: "gpt-5"');
    expect(file.endsWith('You are a meticulous reviewer.\n')).toBe(true);
    // Claude tool names are NOT carried (vocabularies differ — declared narrowing).
    expect(file).not.toContain('tools:');
    expect(copilotSpecialistArgs(name!)).toEqual(['--agent', name]);
  });

  it('Declared degradation when translation is unsupported', () => {
    // A specialist whose name yields no usable slug cannot become a copilot
    // agent — the caller surfaces a refusal instead of launching unconfigured.
    expect(copilotAgentName('!!!')).toBeNull();
    expect(copilotAgentName('')).toBeNull();
  });

  it('omits model frontmatter when the specialist has none', () => {
    const file = copilotAgentFile(spec({ model: undefined }));
    expect(file).not.toContain('model:');
    // A blank persona still produces valid frontmatter-only content.
    const empty = copilotAgentFile(spec({ prompt: '' }));
    expect(empty.startsWith('---\n')).toBe(true);
  });
});
