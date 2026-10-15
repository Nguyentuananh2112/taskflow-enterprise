import { describe, expect, it } from 'vitest';

import { transientDbErrorCode } from './transient-db-error';

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
