import { describe, it, expect } from 'vitest';
import { taskAgentReturnedToUser } from './agentTask';

describe('project-tasks — agent task auto-archive', () => {
  const submitted = [
    { hookEventName: 'SessionStart' },
    { hookEventName: 'UserPromptSubmit' },
    { hookEventName: 'PreToolUse' },
    { hookEventName: 'PostToolUse' },
    { hookEventName: 'Stop' }
  ];

  it('Agent task archives when it returns to the user', () => {
    // Worked (a UserPromptSubmit is present) and now waiting at the prompt → archive.
    expect(taskAgentReturnedToUser('waiting', submitted)).toBe(true);
    expect(taskAgentReturnedToUser('finished', submitted)).toBe(true);
  });

  it('does not archive a still-working agent', () => {
    expect(taskAgentReturnedToUser('working', submitted)).toBe(false);
  });

  it('does not archive a fresh agent that has not started its turn', () => {
    // Just launched, sitting idle at the prompt with no submitted prompt yet.
    expect(taskAgentReturnedToUser('waiting', [{ hookEventName: 'SessionStart' }])).toBe(false);
    expect(taskAgentReturnedToUser('waiting', [])).toBe(false);
  });

  it('Agent task is not archived after a user interrupt', () => {
    // Esc on a task-spawned agent injects a SYNTHETIC Stop (→ waiting) so the user can
    // take the session over. That must NOT auto-archive the pane out from under them.
    const interrupted = [
      { hookEventName: 'SessionStart' },
      { hookEventName: 'UserPromptSubmit' },
      { hookEventName: 'PreToolUse' },
      { hookEventName: 'Stop', synthetic: true }
    ];
    expect(taskAgentReturnedToUser('waiting', interrupted)).toBe(false);
    // A GENUINE turn-end (real Stop, no synthetic flag) still archives.
    expect(
      taskAgentReturnedToUser('waiting', [
        { hookEventName: 'UserPromptSubmit' },
        { hookEventName: 'Stop' }
      ])
    ).toBe(true);
  });
});
