// F3 (Tech Lead): auth giữ bản sao `isSlugConflict` của workspace (tránh phụ thuộc ngược chiều). Test này
// giữ hai bản khớp nhau trên ĐÚNG lỗi mà hạ tầng dựng ra: unique `workspaces_slug_key` của Postgres
// ⇒ `CONFLICTS` ⇒ `ResourceConflictError`; và `slugConflict()` (slug dành riêng / InMemory).
import { describe, expect, it } from 'vitest';

import { ResourceConflictError } from '../core/errors';
import { isSlugConflict as authIsSlugConflict } from '../modules/auth/application/use-cases/register.use-case';
import {
  isSlugConflict as workspaceIsSlugConflict,
  slugConflict,
} from '../modules/workspace/application/workspace-creator';
import { CONFLICTS } from '../modules/workspace/infrastructure/persistence/prisma/db';

const both = (err: unknown) => [workspaceIsSlugConflict(err), authIsSlugConflict(err)];

describe('isSlugConflict: bản của auth khớp bản của workspace', () => {
  it('unique workspaces_slug_key (đường Prisma) ⇒ cả hai nhận là trùng slug', () => {
    const slugKey = CONFLICTS['workspaces_slug_key'];
    expect(slugKey, 'tên constraint của slug phải còn trong CONFLICTS').toBeDefined();
    expect(both(new ResourceConflictError(slugKey!))).toEqual([true, true]);
  });

  it('slugConflict() (slug dành riêng / InMemory) ⇒ cả hai nhận là trùng slug', () => {
    expect(both(slugConflict())).toEqual([true, true]);
  });

  it('conflict KHÁC (keyPrefix, already_member) và lỗi thường ⇒ cả hai đều không', () => {
    for (const [name, details] of Object.entries(CONFLICTS)) {
      if (name === 'workspaces_slug_key') continue;
      expect(both(new ResourceConflictError(details)), name).toEqual([false, false]);
    }
    expect(both(new Error('db down'))).toEqual([false, false]);
  });
});
