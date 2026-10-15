import { describe, expect, it } from 'vitest';

import { ProjectArchivedError, ValidationError } from '../../../core/errors';
import { Project } from './project';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const LATER = new Date('2026-11-02T00:00:00.000Z');
const create = (
  over: Partial<{ name: string; keyPrefix: string; description: string | null }> = {},
) =>
  Project.create({
    id: 'p1',
    workspaceId: 'ws1',
    name: 'Website',
    keyPrefix: 'WEB',
    description: null,
    now: NOW,
    ...over,
  });
const codes = (fn: () => unknown) => {
  try {
    fn();
    return expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues.map((i) => `${i.path.join('.')}:${i.code}`);
  }
};

describe('Project', () => {
  it('create: chưa archive, nextTaskNumber = 1 (PRJ-01)', () => {
    expect(create().toSnapshot()).toEqual({
      id: 'p1',
      workspaceId: 'ws1',
      name: 'Website',
      keyPrefix: 'WEB',
      description: null,
      nextTaskNumber: 1,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it.each(['web', '1AB', 'A', 'ABCDEFGHIJK', 'WE-B', ''])(
    'keyPrefix %j ⇒ 400 (PRJ-05, R17)',
    (keyPrefix) => {
      expect(codes(() => create({ keyPrefix }))).toEqual(['keyPrefix:invalid_format']);
    },
  );

  it.each(['WEB', 'TF', 'A1', 'ABCDEFGHIJ'])('keyPrefix %j hợp lệ', (keyPrefix) => {
    expect(create({ keyPrefix }).keyPrefix).toBe(keyPrefix);
  });

  it('description: trim, rỗng ⇒ null, tối đa 2000 ký tự', () => {
    expect(create({ description: '   ' }).toSnapshot().description).toBeNull();
    expect(create({ description: ' x ' }).toSnapshot().description).toBe('x');
    expect(codes(() => create({ description: 'a'.repeat(2001) }))).toEqual(['description:too_big']);
  });

  it('update name/description (PRU-01); bỏ qua field không truyền', () => {
    const p = create({ description: 'd' });
    p.update({ name: ' Site ' }, LATER);
    expect(p.toSnapshot()).toMatchObject({ name: 'Site', description: 'd', updatedAt: LATER });
    p.update({ description: null }, LATER);
    expect(p.toSnapshot().description).toBeNull();
  });

  it('update khi archived ⇒ ProjectArchivedError (PRU-03)', () => {
    const p = create();
    p.archive(NOW);
    expect(() => p.update({ name: 'X' }, LATER)).toThrow(ProjectArchivedError);
  });

  it('archive idempotent: archivedAt giữ lần đầu (ARC-01/02); unarchive idempotent (ARC-05)', () => {
    const p = create();
    expect(p.archive(NOW)).toBe(true);
    expect(p.archive(LATER)).toBe(false);
    expect(p.toSnapshot().archivedAt).toEqual(NOW);
    expect(p.isArchived).toBe(true);
    expect(p.unarchive(LATER)).toBe(true);
    expect(p.unarchive(LATER)).toBe(false);
    expect(p.toSnapshot()).toMatchObject({ archivedAt: null, updatedAt: LATER });
  });
});
