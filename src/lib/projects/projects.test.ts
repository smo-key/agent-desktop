import { describe, expect, it } from 'vitest';
import {
  addProject,
  removeProject,
  updateProject,
  hexA,
  parseProjects,
  projectForId,
  projectForPath,
  projectLabel,
  serializeProjects,
  slugify,
  contrastText,
  type Project
} from './projects';

// Tests for the PURE projects model (projects capability). The `it(...)` titles
// matching `#### Scenario:` names in the projects spec are mapped by the coverage
// gate; the rest are supporting unit tests.

function p(over: Partial<Project> = {}): Project {
  return {
    id: 'id-1',
    name: 'Payments',
    path: '/home/u/payments',
    icon: 'credit-card',
    color: '#4C8DFF',
    ...over
  };
}

describe('projects — Create a project', () => {
  it('Creating a project adds it to the head, deduped by folder', () => {
    const a = p({ id: 'a', path: '/x', name: 'X' });
    const b = p({ id: 'b', path: '/y', name: 'Y' });
    const list = addProject(addProject([], a), b);
    expect(list.map((x) => x.id)).toEqual(['b', 'a']); // newest first

    // Re-adding the same FOLDER replaces in place (keeps the original id so bound
    // panes stay valid) and moves it to the head with the new name/icon/color.
    const a2 = p({ id: 'a-new', path: '/x', name: 'X renamed', icon: 'globe', color: '#36C2C2' });
    const next = addProject(list, a2);
    expect(next.map((x) => x.id)).toEqual(['a', 'b']); // kept id 'a', moved to head
    expect(next[0]).toMatchObject({ id: 'a', name: 'X renamed', icon: 'globe' });

    // A blank path is ignored.
    expect(addProject(list, p({ path: '   ' }))).toEqual(list);
  });
});

describe('projects — model helpers', () => {
  it('removes a project by id', () => {
    const list = [p({ id: 'a', path: '/x' }), p({ id: 'b', path: '/y' })];
    expect(removeProject(list, 'a').map((x) => x.id)).toEqual(['b']);
    expect(removeProject(list, 'nope')).toEqual(list); // no-op when absent
  });

  it('resolves a project by id and by path', () => {
    const list = [p({ id: 'a', path: '/x' }), p({ id: 'b', path: '/y' })];
    expect(projectForId(list, 'b')?.path).toBe('/y');
    expect(projectForId(list, 'nope')).toBeNull();
    expect(projectForId(list, null)).toBeNull();
    expect(projectForPath(list, '/x')?.id).toBe('a');
    expect(projectForPath(list, '/none')).toBeNull();
  });

  it('round-trips through serialize/parse and tolerates garbage', () => {
    const list = [p({ id: 'a', path: '/x' }), p({ id: 'b', path: '/y', name: 'Y' })];
    expect(parseProjects(serializeProjects(list))).toEqual(list);

    // Bare array form is accepted; invalid entries + duplicate paths are dropped.
    const messy = JSON.stringify([
      p({ id: 'a', path: '/x' }),
      { id: '', path: '/bad' }, // missing id
      { id: 'c' }, // missing path
      p({ id: 'dup', path: '/x' }) // duplicate path -> dropped (first wins)
    ]);
    expect(parseProjects(messy).map((x) => x.id)).toEqual(['a']);

    // Failures collapse to [] without throwing.
    expect(parseProjects(null)).toEqual([]);
    expect(parseProjects('')).toEqual([]);
    expect(parseProjects('{not json')).toEqual([]);
  });

  it('slugify, hexA, and projectLabel behave', () => {
    expect(slugify('Payments API!')).toBe('payments-api');
    expect(slugify('  ---  ')).toBe('');
    expect(hexA('#4C8DFF', 0.14)).toBe('rgba(76, 141, 255, 0.14)');
    expect(hexA('not-a-hex', 0.2)).toBe('rgba(125, 132, 153, 0.2)');
    expect(projectLabel(p({ name: '  ', path: '/home/u/web-app' }))).toBe('web-app');
    expect(projectLabel(p({ name: 'Named' }))).toBe('Named');
  });
});

describe('updateProject — Edit a project', () => {
  it('patches fields of the matching project and keeps its id', () => {
    const list = [p({ id: 'a', name: 'A' }), p({ id: 'b', path: '/b', name: 'B' })];
    const next = updateProject(list, 'b', { name: 'B2', color: '#111111' });
    expect(next.map((x) => x.id)).toEqual(['a', 'b']); // order + id preserved
    expect(next[1]).toMatchObject({ id: 'b', name: 'B2', color: '#111111', path: '/b' });
  });

  it('sets a logo and clears it again via logo: undefined', () => {
    const list = [p({ id: 'a' })];
    const withLogo = updateProject(list, 'a', { logo: 'data:image/png;base64,XYZ' });
    expect(withLogo[0].logo).toBe('data:image/png;base64,XYZ');
    const cleared = updateProject(withLogo, 'a', { logo: undefined });
    expect('logo' in cleared[0] && cleared[0].logo !== undefined).toBe(false);
  });

  it('is a no-op when the id is absent and never mutates the input', () => {
    const list = [p({ id: 'a' })];
    const frozen = JSON.stringify(list);
    const next = updateProject(list, 'missing', { name: 'X' });
    expect(next).toEqual(list);
    expect(JSON.stringify(list)).toBe(frozen); // input untouched
  });
});

describe('logo field — persistence', () => {
  it('round-trips a project with a logo and accepts one without', () => {
    const withLogo = p({ id: 'a', logo: 'data:image/png;base64,AAA' });
    const without = p({ id: 'b', path: '/b' });
    const json = serializeProjects([withLogo, without]);
    const back = parseProjects(json);
    expect(back[0].logo).toBe('data:image/png;base64,AAA');
    expect(back[1].logo).toBeUndefined();
  });

  it('drops a non-string logo while keeping the rest of the record', () => {
    const raw = JSON.stringify([{ ...p({ id: 'a' }), logo: 123 }]);
    const back = parseProjects(raw);
    expect(back).toHaveLength(1);
    expect(back[0].logo).toBeUndefined();
  });
});

describe('autoWorktree field — persistence', () => {
  it('Toggling the setting persists it', () => {
    // Round-trip: serialize -> parse preserves autoWorktree: true.
    const on = p({ id: 'a', autoWorktree: true });
    const back = parseProjects(serializeProjects([on]));
    expect(back[0].autoWorktree).toBe(true);
  });

  it('Existing projects default to off', () => {
    // A legacy persisted project with no autoWorktree field loads with it
    // absent/falsy — additive optional field, backward compatible.
    const legacy = p({ id: 'b', path: '/b' });
    const back = parseProjects(serializeProjects([legacy]));
    expect(back[0].autoWorktree).toBeUndefined();
    expect(Boolean(back[0].autoWorktree)).toBe(false);
  });

  it('edit-form draft carries autoWorktree through update unchanged', () => {
    // The project form's onSave draft (which includes autoWorktree) flows into
    // projects.update → updateProject. The edit patch must round-trip the flag,
    // so reopening the form reflects the saved value.
    const before = p({ id: 'c', autoWorktree: false });
    const next = updateProject([before], 'c', {
      name: 'Payments',
      path: '/home/u/payments',
      icon: 'credit-card',
      color: '#4C8DFF',
      autoWorktree: true
    });
    expect(next[0].autoWorktree).toBe(true);

    // And it can be turned back off via the same path.
    const off = updateProject(next, 'c', { autoWorktree: false });
    expect(off[0].autoWorktree).toBe(false);
  });
});

describe('contrastText', () => {
  it('dark text on light backgrounds', () => {
    expect(contrastText('#ffffff')).toBe('#06080c');
    expect(contrastText('#3CCB7F')).toBe('#06080c'); // bright green
    expect(contrastText('#F0B341')).toBe('#06080c'); // amber
  });

  it('white text on dark backgrounds', () => {
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('#1e49b4')).toBe('#ffffff'); // deep blue
  });

  it('falls back to white for an unparseable hex', () => {
    expect(contrastText('not-a-color')).toBe('#ffffff');
    expect(contrastText('')).toBe('#ffffff');
  });
});
