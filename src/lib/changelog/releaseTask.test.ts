import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The release procedure lives in the `release` SKILL, and the repo's own
// `.agent-desktop/tasks.json` Release task does nothing but invoke it
// (release-changelog: "A release runbook skill authors the notes and drives the
// release"). Guard both halves of that contract: the task must still delegate,
// and the skill must still carry the load-bearing points the pipeline depends
// on — so a casual edit to either cannot silently drop a step.
//
// The prompt used to carry the whole procedure inline. That was a single JSON
// string: unreviewable in a diff, and it had drifted from the pipeline (it knew
// nothing about the beta lane and told the agent to open a PR to `main`, which
// is wrong for a release branch).

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('Release task', () => {
  it('The task delegates to the skill', () => {
    const { tasks } = JSON.parse(read('.agent-desktop', 'tasks.json')) as {
      tasks: { name: string; kind: string; prompt?: string | null }[];
    };
    const release = tasks.find((t) => t.name === 'Release');
    expect(release?.kind).toBe('agent');
    const prompt = release?.prompt ?? '';
    // Either way of invoking it counts: naming the skill in prose, or the
    // slash-command form. What matters is that the task DELEGATES — asserting
    // one exact phrasing made `/release`, the shortest correct prompt, fail.
    const invokesSkill =
      prompt.toLowerCase().includes('release skill') || /(^|\s)\/release\b/.test(prompt);
    expect(invokesSkill).toBe(true);
    // It delegates — it does not restate the procedure.
    expect(prompt).not.toContain('CHANGELOG.md');
    expect(prompt.length).toBeLessThan(120);
  });
});

describe('Release skill', () => {
  const skill = () => read('.claude', 'skills', 'release', 'SKILL.md');

  it('release task prompt covers the flow', () => {
    // Same load-bearing points the inline prompt used to guarantee, now asserted
    // where they actually live.
    const md = skill();
    expect(md).toContain('yarn check:gate');
    expect(md).toContain('CHANGELOG.md');
    expect(md).toContain('## <version> — <YYYY-MM-DD>');
    expect(md).toContain('### New');
    expect(md).toContain('package.json');
    expect(md).toMatch(/Do not create the tag/i);
  });

  it('The skill covers both lanes', () => {
    const md = skill();
    // Branch -> channel pairing, and the version form for each.
    expect(md).toContain('`main`');
    expect(md).toContain('`beta`');
    expect(md).toMatch(/0\.4\.0-2/); // single-integer prerelease, not -beta.N
    expect(md).toMatch(/single integer/i);
    // The beta lane must never be turned into a PR against the stable lane.
    expect(md).toMatch(/Never open a PR from `beta` to `main`/i);
  });

  it('The version is validated before it is committed', () => {
    // The gate dry run is the authority on releasability; the skill must send
    // the agent to it rather than restating the rules and drifting from them.
    expect(skill()).toContain('DRY_RUN=1');
    expect(skill()).toContain('./scripts/release-gate.sh');
  });
});
