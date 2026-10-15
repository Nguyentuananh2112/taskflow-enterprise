import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

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

  it('tôn trọng LOG_LEVEL', () => {
    const { lines, stream } = capture();
    const logger = createLogger({ level: 'warn', gitSha: 'abc', appEnv: 'test' }, stream);
    logger.info('bỏ qua');
    logger.warn('giữ');
    expect(lines.map((l) => l['msg'])).toEqual(['giữ']);
  });
});
