import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../test/support';
import { assertPersistenceAllowed, createMemoryPersistence } from './persistence';

describe('assertPersistenceAllowed (quyết định Tech Lead — T-020)', () => {
  it.each(['staging', 'production'] as const)(
    '%s: BẤT KỲ module nào chạy bộ nhớ (kể cả "lai") ⇒ từ chối khởi động, nêu tên module',
    (appEnv) => {
      expect(() =>
        assertPersistenceAllowed(appEnv, { auth: 'prisma', workspace: 'prisma', task: 'memory' }),
      ).toThrow(/không được dùng ở .*module: task/);
      expect(() =>
        assertPersistenceAllowed(appEnv, { auth: 'memory', workspace: 'prisma' }),
      ).toThrow(/module: auth/);
    },
  );

  it.each(['staging', 'production'] as const)('%s: mọi module Prisma ⇒ cho phép', (appEnv) => {
    expect(assertPersistenceAllowed(appEnv, { auth: 'prisma', workspace: 'prisma' })).toEqual([]);
  });

  it('local/test: cho phép, trả danh sách module bộ nhớ (để cảnh báo)', () => {
    expect(
      assertPersistenceAllowed('local', { auth: 'prisma', workspace: 'prisma', task: 'memory' }),
    ).toEqual(['task']);
    expect(
      assertPersistenceAllowed('test', createMemoryPersistence(new SpyLogger()).modules),
    ).toEqual(['auth', 'workspace']);
  });
});
