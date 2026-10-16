import { describe, expect, it } from 'vitest';

import { uniqueConstraintOf } from './unique-constraint';

const prismaError = (code: string, cause: Record<string, unknown>) =>
  Object.assign(new Error('prisma'), { code, meta: { driverAdapterError: { cause } } });
const unique = (index: string) => ({ originalCode: '23505', constraint: { index } });

describe('uniqueConstraintOf', () => {
  it('API model (P2002) ⇒ tên constraint', () => {
    expect(uniqueConstraintOf(prismaError('P2002', unique('users_email_key')))).toBe(
      'users_email_key',
    );
  });

  it('SQL thô (P2010 + SQLSTATE 23505) ⇒ tên constraint', () => {
    expect(uniqueConstraintOf(prismaError('P2010', unique('tasks_rank_live_key')))).toBe(
      'tasks_rank_live_key',
    );
  });

  it('P2010 với SQLSTATE khác (check / FK / deadlock) ⇒ null, dù có tên constraint', () => {
    for (const originalCode of ['23514', '23503', '40P01']) {
      expect(
        uniqueConstraintOf(prismaError('P2010', { originalCode, constraint: { index: 'x_key' } })),
      ).toBeNull();
    }
  });

  it('thiếu tên constraint / mã Prisma khác / không phải object ⇒ null', () => {
    expect(uniqueConstraintOf(prismaError('P2002', { originalCode: '23505' }))).toBeNull();
    expect(uniqueConstraintOf(prismaError('P2025', unique('users_email_key')))).toBeNull();
    expect(uniqueConstraintOf(Object.assign(new Error('x'), { code: 'P2002' }))).toBeNull();
    expect(uniqueConstraintOf('P2002')).toBeNull();
    expect(uniqueConstraintOf(null)).toBeNull();
  });
});
