import { describe, expect, it } from 'vitest';

// Unit tests for the PURE specialist → claude-CLI-args mapping (design D4). Runs
// under the default node env (no Svelte/Tauri imports in the module under test).

import { specialistLaunchArgs } from './launchArgs';
import type { Specialist } from '../specialists/specialists';

function spec(over: Partial<Specialist> = {}): Specialist {
  return { name: 's', description: 'd', prompt: 'You are a tester.', ...over };
}

describe('specialistLaunchArgs', () => {
  it('maps all fields: body → --append-system-prompt, model, allowedTools', () => {
    const s = spec({
      prompt: 'You are a meticulous test author.',
      model: 'claude-sonnet-4-6',
      tools: ['Read', 'Edit', 'Bash']
    });
    expect(specialistLaunchArgs(s)).toEqual([
      '--append-system-prompt',
      'You are a meticulous test author.',
      '--model',
      'claude-sonnet-4-6',
      '--allowedTools',
      'Read',
      'Edit',
      'Bash'
    ]);
  });

  it('only-required: just the body becomes --append-system-prompt', () => {
    const s = spec({ prompt: 'Persona only.' });
    expect(specialistLaunchArgs(s)).toEqual(['--append-system-prompt', 'Persona only.']);
  });

  it('with-tools but no model: emits each tool as a separate arg, no --model', () => {
    const s = spec({ prompt: 'Body.', tools: ['Read', 'Grep'] });
    expect(specialistLaunchArgs(s)).toEqual([
      '--append-system-prompt',
      'Body.',
      '--allowedTools',
      'Read',
      'Grep'
    ]);
  });

  it('omits the body when blank, and omits empty/blank model + tools', () => {
    const s = spec({ prompt: '   ', model: '  ', tools: ['', '  '] });
    expect(specialistLaunchArgs(s)).toEqual([]);
  });

  it('passes the body VERBATIM (untrimmed) once it is non-blank', () => {
    const s = spec({ prompt: '  leading + trailing spaces kept  ' });
    expect(specialistLaunchArgs(s)).toEqual([
      '--append-system-prompt',
      '  leading + trailing spaces kept  '
    ]);
  });
});
