import { describe, expect, it } from 'vitest';

import { dbSqlStateOf, transientDbErrorCode } from './transient-db-error';

const prismaError = (originalCode: string) =>
  Object.assign(new Error('raw query failed'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode, kind: 'postgres' } } },
  });

describe('transientDbErrorCode (review B T-033 F3/F5)', () => {
  it.each(['40P01', '40001', '55P03'])('%s qua Prisma 7 + adapter-pg ⇒ tạm thời', (code) => {
    expect(transientDbErrorCode(prismaError(code))).toBe(code);
  });

  it('mã pg trực tiếp và nằm trong chuỗi cause ⇒ nhận ra', () => {
    expect(transientDbErrorCode(Object.assign(new Error('x'), { code: '55P03' }))).toBe('55P03');
    expect(transientDbErrorCode(new Error('wrap', { cause: prismaError('40P01') }))).toBe('40P01');
  });

  it('lỗi khác (unique, check, mã Prisma, không phải object) ⇒ null', () => {
    expect(transientDbErrorCode(prismaError('23505'))).toBeNull();
    expect(transientDbErrorCode(Object.assign(new Error('x'), { code: 'P2002' }))).toBeNull();
    expect(transientDbErrorCode('55P03')).toBeNull();
    expect(transientDbErrorCode(null)).toBeNull();
  });
});

describe('dbSqlStateOf (log maintenance.run_failed — TL 18/10)', () => {
  it('SQLSTATE gốc từ Prisma adapter / pg / chuỗi cause; không có / không hợp lệ ⇒ undefined (không lộ message)', () => {
    const adapter = (code: unknown) => ({
      code: 'P2039',
      message: 'relation "company_members" does not exist — có thể chứa dữ liệu',
      meta: { driverAdapterError: { cause: { originalCode: code } } },
    });
    expect(dbSqlStateOf(adapter('42P01'))).toBe('42P01');
    expect(dbSqlStateOf({ code: '23505' })).toBe('23505');
    expect(dbSqlStateOf(new Error('x', { cause: { code: '40P01' } }))).toBe('40P01');
    expect(dbSqlStateOf(adapter('relation users'))).toBeUndefined();
    expect(dbSqlStateOf({ code: 'P2002' })).toBeUndefined();
    expect(dbSqlStateOf(null)).toBeUndefined();
    expect(dbSqlStateOf('42P01')).toBeUndefined();
  });
});

describe('transientDbErrorCode — Prisma P2034 (B 18/10)', () => {
  it('P2034 không có originalCode ⇒ 40001 (chạy lại); có originalCode deadlock ⇒ giữ 40P01; P2002 ⇒ null', () => {
    expect(transientDbErrorCode({ code: 'P2034', message: 'write conflict' })).toBe('40001');
    expect(
      transientDbErrorCode({
        code: 'P2034',
        meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
      }),
    ).toBe('40P01');
    expect(transientDbErrorCode(new Error('x', { cause: { code: 'P2034' } }))).toBe('40001');
    expect(transientDbErrorCode({ code: 'P2002' })).toBeNull();
  });
});
