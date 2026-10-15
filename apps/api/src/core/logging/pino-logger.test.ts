import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  leakedSecrets,
  prismaCheckViolation,
  prismaValidationError,
} from '../../../test/support/prisma-errors';
import { createLogger } from './pino-logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('log JSON có level dạng chữ, time ISO, gitSha, appEnv', () => {
    const { lines, stream } = capture();
    createLogger({ level: 'info', gitSha: 'abc', appEnv: 'test' }, stream).info({ a: 1 }, 'hello');
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'hello',
      a: 1,
      gitSha: 'abc',
      appEnv: 'test',
    });
    expect(String(lines[0]?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('redact token/mật khẩu/header nhạy cảm (security.md §6.7, SEC-33)', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'info', gitSha: 'abc', appEnv: 'test' }, stream);
    logger.info(
      {
        req: { headers: { authorization: 'Bearer eyJ.secret', cookie: 'rt=secret', host: 'api' } },
        res: { headers: { 'set-cookie': 'rt=secret' } },
        body: {
          email: 'mia@example.com',
          password: 'p1',
          newPassword: 'p2',
          currentPassword: 'p3',
        },
        accessToken: 'at',
        refreshToken: 'rt',
        token: 't',
      },
      'login',
    );
    const text = JSON.stringify(lines[0]);
    for (const secret of [
      'eyJ.secret',
      'rt=secret',
      '"p1"',
      '"p2"',
      '"p3"',
      '"at"',
      '"rt"',
      '"t"',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('mia@example.com');
    expect(text).toContain('"host":"api"');
    expect(text).toContain('[REDACTED]');
  });

  it.each([
    ['production', false],
    ['local', true],
  ] as const)(
    'T-031 mục 0 (%s): `err` qua serializer allow-list — không email/hash; stack chỉ ngoài prod',
    (appEnv, hasStack) => {
      const { lines, stream } = capture();
      const logger = createLogger({ level: 'info', gitSha: 'abc', appEnv }, stream);
      logger.error({ err: prismaCheckViolation() }, 'db');
      logger.error({ err: prismaValidationError() }, 'db');
      logger.error({ err: new Error('plain') }, 'plain');
      // Dự phòng: lỗi Prisma lỡ log dưới key khác ⇒ redact path bắt `meta.driverAdapterError`.
      logger.error({ failure: prismaCheckViolation() }, 'other-key');
      expect(leakedSecrets(lines.slice(0, 2).concat(lines[3] ?? {}))).toEqual([]);
      expect(lines[0]?.['err']).toMatchObject({
        name: 'PrismaClientKnownRequestError',
        code: 'P2039',
      });
      expect(lines[1]?.['err']).toEqual({ name: 'PrismaClientValidationError' });
      expect(Boolean((lines[2]?.['err'] as { stack?: string }).stack)).toBe(hasStack);
    },
  );

  it('tôn trọng LOG_LEVEL', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'warn', gitSha: 'abc', appEnv: 'test' }, stream);
    logger.info('bỏ qua');
    logger.warn('giữ');
    expect(lines.map((l) => l['msg'])).toEqual(['giữ']);
  });
});
