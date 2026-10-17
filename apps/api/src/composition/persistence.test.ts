import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../test/support';
import {
  assertPersistenceAllowed,
  createMemoryPersistence,
  createPrismaPersistence,
} from './persistence';

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
    ).toEqual(['attendance', 'auth', 'company', 'notifications', 'task', 'workspace']);
  });
});

describe('createPrismaPersistence (T-023)', () => {
  it('wire đủ module task bằng Prisma ⇒ production khởi động được, không còn trạng thái lai', () => {
    // Không kết nối DB: chỉ dựng đồ thị đối tượng (client Prisma lazy, Valkey không gọi tới).
    const p = createPrismaPersistence({
      prisma: {} as never,
      valkey: {} as never,
      logger: new SpyLogger(),
    });
    expect(p.modules).toEqual({
      auth: 'prisma',
      workspace: 'prisma',
      task: 'prisma',
      notifications: 'prisma',
      company: 'prisma',
      attendance: 'prisma',
    });
    expect(Object.keys(p.company).sort()).toEqual(['company', 'hrAudit', 'members', 'tenures']);
    expect(Object.keys(p.task ?? {}).sort()).toEqual([
      'assignees',
      'audit',
      'projects',
      'readModel',
      'tasks',
      'users',
    ]);
    expect(assertPersistenceAllowed('production', p.modules)).toEqual([]);
  });
});
