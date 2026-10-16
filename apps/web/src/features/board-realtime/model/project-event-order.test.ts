import type { ProjectDto } from '@taskflow/contracts/project';
import { describe, expect, it } from 'vitest';

import { isStaleProjectEvent } from './project-event-order';

const at = (updatedAt: string, isArchived = false): ProjectDto => ({
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  name: 'Dự án',
  keyPrefix: 'TF',
  description: null,
  isArchived,
  archivedAt: isArchived ? updatedAt : null,
  createdAt: '2026-10-16T08:00:00.000Z',
  updatedAt,
});

describe('isStaleProjectEvent (G1 W4)', () => {
  it('chưa có cache ⇒ nhận', () => {
    expect(isStaleProjectEvent(undefined, at('2026-10-16T09:00:00.000Z'))).toBe(false);
  });
  it('event mới hơn ⇒ nhận; cũ hơn (đến lệch thứ tự) ⇒ bỏ', () => {
    const archived = at('2026-10-16T09:00:00.500Z', true);
    expect(isStaleProjectEvent(at('2026-10-16T09:00:00.000Z'), archived)).toBe(false);
    expect(isStaleProjectEvent(archived, at('2026-10-16T09:00:00.000Z'))).toBe(true);
  });
  it('cùng mili-giây ⇒ nhận bản đến sau', () => {
    const t = '2026-10-16T09:00:00.000Z';
    expect(isStaleProjectEvent(at(t), at(t, true))).toBe(false);
  });
});
