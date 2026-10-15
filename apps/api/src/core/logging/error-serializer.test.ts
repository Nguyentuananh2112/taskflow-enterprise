import { describe, expect, it } from 'vitest';

import {
  leakedSecrets,
  LEAK_EMAIL,
  LEAK_HASH,
  prismaCheckViolation,
  prismaValidationError,
} from '../../../test/support/prisma-errors';
import { InternalError } from '../errors';
import { scrubText, serializeError } from './error-serializer';

describe('serializeError — allow-list (T-031 mục 0)', () => {
  it('P2039 (vi phạm CHECK): chỉ name, code, modelName, kind/originalCode/constraint — không dữ liệu dòng', () => {
    const out = serializeError(prismaCheckViolation(), { includeStack: true });
    expect(out).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      meta: {
        modelName: 'User',
        driverAdapterError: {
          cause: {
            kind: 'postgres',
            originalCode: '23514',
            constraint: 'users_email_lowercase_chk',
          },
        },
      },
    });
    expect(leakedSecrets(out)).toEqual([]);
  });

  it('P2002: constraint lấy từ cause.constraint.index / fields (chỉ định danh SQL)', () => {
    const err = (constraint: unknown) =>
      Object.assign(new Error('x'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { driverAdapterError: { cause: { kind: 'UniqueConstraintViolation', constraint } } },
      });
    const constraintOf = (c: unknown) =>
      serializeError(err(c), { includeStack: false }).meta?.driverAdapterError?.cause.constraint;
    expect(constraintOf({ index: 'users_email_key' })).toBe('users_email_key');
    expect(constraintOf({ fields: ['workspace_id', 'user_id'] })).toEqual([
      'workspace_id',
      'user_id',
    ]);
    expect(constraintOf({ index: `x ${LEAK_EMAIL}` })).toBeUndefined();
    expect(constraintOf({ fields: [LEAK_EMAIL] })).toBeUndefined();
  });

  it('PrismaClientValidationError: chỉ name (message chứa giá trị tham số)', () => {
    const out = serializeError(prismaValidationError(), { includeStack: true });
    expect(out).toEqual({ name: 'PrismaClientValidationError' });
  });

  it('lỗi lạ: message qua bộ lọc mẫu; stack chỉ dòng frame (dòng đầu lặp message) và chỉ khi includeStack', () => {
    const err = new Error(
      `boom for ${LEAK_EMAIL} hash ${LEAK_HASH} url postgresql://app:s3cret@db:5432/x token=abc.def`,
    );
    const withStack = serializeError(err, { includeStack: true });
    expect(withStack.message).toBe(
      'boom for [REDACTED_EMAIL] hash [REDACTED_HASH] url postgresql://[REDACTED]@db:5432/x token=[REDACTED]',
    );
    expect(withStack.stack).toMatch(/^\s+at /);
    expect(leakedSecrets(withStack)).toEqual([]);
    expect(JSON.stringify(withStack)).not.toContain('s3cret');
    expect(serializeError(err, { includeStack: false })).not.toHaveProperty('stack');
  });

  it('cause đệ quy dùng cùng luật (InternalError bọc lỗi Prisma), tối đa 3 tầng', () => {
    const out = serializeError(new InternalError(prismaCheckViolation()), { includeStack: false });
    expect(out).toMatchObject({
      name: 'InternalError',
      code: 'INTERNAL_ERROR',
      cause: { name: 'PrismaClientKnownRequestError', code: 'P2039' },
    });
    expect(leakedSecrets(out)).toEqual([]);

    let deep: unknown = new Error('level 5');
    for (let i = 4; i >= 0; i--) deep = new Error(`level ${i}`, { cause: deep });
    let depth = 0;
    for (let e = serializeError(deep, { includeStack: false }); e.cause; e = e.cause) depth++;
    expect(depth).toBe(3);
  });

  it('object thường (pino-http đã chạy serializer chuẩn) và giá trị không phải object', () => {
    const plain = { type: 'PrismaClientKnownRequestError', ...prismaCheckViolation() };
    expect(leakedSecrets(serializeError(plain, { includeStack: true }))).toEqual([]);
    expect(serializeError(`thrown ${LEAK_EMAIL}`, { includeStack: false })).toEqual({
      name: 'string',
      message: 'thrown [REDACTED_EMAIL]',
    });
    expect(
      serializeError({ name: 'bad name with spaces', code: 'x y' }, { includeStack: false }),
    ).toEqual({ name: 'Error' });
  });

  it('scrubText: "Failing row contains (…)" và chuỗi base64/hex dài; cắt message quá dài', () => {
    expect(scrubText('Failing row contains (1, a, b).')).toBe('Failing row contains ([REDACTED]).');
    expect(scrubText(`jwt ${'a'.repeat(40)}`)).toBe('jwt [REDACTED]');
    expect(scrubText('x'.repeat(2_000)).length).toBeLessThan(1_100);
  });
});
