import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The repo's own `.agent-desktop/tasks.json` carries the Release agent task
// that authors CHANGELOG.md. Guard the prompt's load-bearing points so a casual
// edit in the Tasks panel cannot silently drop a step the release pipeline
// depends on (release-changelog: "Release task authors the notes").

describe('Release task', () => {
  it('release task prompt covers the flow', () => {
    const file = join(process.cwd(), '.agent-desktop', 'tasks.json');
    const { tasks } = JSON.parse(readFileSync(file, 'utf8')) as {
      tasks: { name: string; kind: string; prompt?: string | null }[];
    };
    const release = tasks.find((t) => t.name === 'Release');
    expect(release?.kind).toBe('agent');
    const prompt = release?.prompt ?? '';
    expect(prompt).toContain('yarn check:gate');
    expect(prompt).toContain('CHANGELOG.md');
    expect(prompt).toContain('## <version> — <YYYY-MM-DD>');
    expect(prompt).toContain('### New');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('main');
    expect(prompt).toMatch(/Do NOT create the tag/);
  });
});
