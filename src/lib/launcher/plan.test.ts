import { describe, expect, it } from 'vitest';
import { buildLaunchPlan, isSplitPlacement, type LaunchPlan } from './plan';

// Tests for the PURE launch-plan builder that normalizes the launcher's raw form
// inputs into a {program:'claude', cwd, placement, initialInput} plan. The
// `it(...)` titles for Placement + the slash-command guarantee are the EXACT
// `#### Scenario:` names from the session-launcher spec (Requirements: Placement
// As New Tab Or Split Of Focused Pane, No Auto-Run Of Slash Commands) so the
// coverage gate can match them. The native picker + live spawn are MANUAL; this
// proves the load-bearing properties: program is always claude, the plan's
// initialInput is EXACTLY the user's text and never a synthesized /command.

describe('buildLaunchPlan — Placement As New Tab Or Split Of Focused Pane', () => {
  it('Open the session in a new tab', () => {
    // The "new tab" placement produces a plan that opens a fresh workspace/leaf.
    const plan = buildLaunchPlan({ folder: '/proj/a', placement: 'tab' });
    expect(plan.program).toBe('claude');
    expect(plan.cwd).toBe('/proj/a');
    expect(plan.placement).toBe('tab');
    expect(plan.initialInput).toBeUndefined();
  });

  it('Open the session by splitting the focused pane', () => {
    // A split placement is preserved when a pane is focused (canSplit = true),
    // carrying the chosen cwd so the new leaf spawns claude there.
    const right = buildLaunchPlan(
      { folder: '/proj/b', placement: 'split-right' },
      true
    );
    expect(right.placement).toBe('split-right');
    expect(right.program).toBe('claude');
    expect(right.cwd).toBe('/proj/b');

    const down = buildLaunchPlan(
      { folder: '/proj/c', placement: 'split-down' },
      true
    );
    expect(down.placement).toBe('split-down');
    expect(isSplitPlacement('split-right')).toBe(true);
    expect(isSplitPlacement('split-down')).toBe(true);
    expect(isSplitPlacement('tab')).toBe(false);
  });

  it('Split placement is unavailable with no focused pane', () => {
    // With no focused pane (canSplit = false), a requested split FALLS BACK to a
    // new tab so the launch still succeeds rather than splitting nothing.
    const right = buildLaunchPlan(
      { folder: '/proj/d', placement: 'split-right' },
      false
    );
    expect(right.placement).toBe('tab');

    const down = buildLaunchPlan(
      { folder: '/proj/d', placement: 'split-down' },
      false
    );
    expect(down.placement).toBe('tab');

    // A plain new-tab request is unaffected by canSplit either way.
    expect(buildLaunchPlan({ folder: '/x', placement: 'tab' }, false).placement).toBe(
      'tab'
    );
  });
});

describe('buildLaunchPlan — No Auto-Run Of Slash Commands', () => {
  // NOTE: the spec scenarios "No slash command is injected on launch" and
  // "Initial prompt beginning with a slash is passed through verbatim" are owned
  // (for the coverage gate) by initialInput.test.ts, which exercises the layer
  // that actually writes to the PTY. These plan-level tests assert the same
  // guarantee at the plan-builder boundary but use distinct titles so each
  // scenario maps to EXACTLY ONE covering test.
  it('plan builder never fabricates a slash command', () => {
    // With NO prompt the plan's initialInput is undefined — the builder never
    // fabricates a /workflow:* (or any) command to run on launch.
    const noPrompt = buildLaunchPlan({ folder: '/p', placement: 'tab' });
    expect(noPrompt.initialInput).toBeUndefined();
    const blank = buildLaunchPlan({
      folder: '/p',
      placement: 'tab',
      prompt: '   '
    });
    expect(blank.initialInput).toBeUndefined();
    const nullPrompt = buildLaunchPlan({
      folder: '/p',
      placement: 'tab',
      prompt: null
    });
    expect(nullPrompt.initialInput).toBeUndefined();

    // With a prompt, initialInput is EXACTLY the user's text — no slash command
    // is prepended/appended/synthesized.
    const withPrompt = buildLaunchPlan({
      folder: '/p',
      placement: 'tab',
      prompt: 'fix the failing test'
    });
    expect(withPrompt.initialInput).toBe('fix the failing test');
    expect(withPrompt.initialInput).not.toContain('/');
  });

  it('plan builder preserves a leading-slash prompt byte-for-byte', () => {
    // A user prompt that itself begins with `/` is preserved BYTE-FOR-BYTE in the
    // plan — the launcher does not expand, intercept, or execute it as a command.
    const plan = buildLaunchPlan({
      folder: '/p',
      placement: 'tab',
      prompt: '/release the build'
    });
    expect(plan.initialInput).toBe('/release the build');

    // Multi-line and leading-slash content survives untouched (no trimming of the
    // content itself, only the blank-vs-nonblank decision is whitespace-aware).
    const multi = buildLaunchPlan({
      folder: '/p',
      placement: 'tab',
      prompt: '/plan\nstep one\nstep two'
    });
    expect(multi.initialInput).toBe('/plan\nstep one\nstep two');
  });
});

describe('buildLaunchPlan — normalization', () => {
  it('always uses claude as the program and trims the cwd', () => {
    const plan: LaunchPlan = buildLaunchPlan({
      folder: '  /proj/with-spaces  ',
      placement: 'tab'
    });
    expect(plan.program).toBe('claude');
    expect(plan.cwd).toBe('/proj/with-spaces');
  });

  it('Project assigned at launch', () => {
    expect(buildLaunchPlan({ folder: '/p', placement: 'tab', projectId: 'pay' }).projectId).toBe(
      'pay'
    );
    expect(buildLaunchPlan({ folder: '/p', placement: 'tab' }).projectId).toBeUndefined();
    expect(
      buildLaunchPlan({ folder: '/p', placement: 'tab', projectId: '  ' }).projectId
    ).toBeUndefined();
  });
});
