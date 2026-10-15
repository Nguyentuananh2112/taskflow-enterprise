import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { HttpResponder } from './envelope';
import { globalErrorHandler, toAppError } from './error-handler';
import { databaseProbe, valkeyProbe } from './health';
import { requireAllowedOrigin, resolveRequestId } from './middleware';
import { errorOf, FakeClock, SpyLogger } from '../../../test/support';
import { InternalError, UnauthorizedError } from '../errors';

describe('databaseProbe / valkeyProbe', () => {
  it('db: chạy SELECT 1, critical, timeout 1s', async () => {
    const queries: string[] = [];
    const probe = databaseProbe({ query: (sql) => Promise.resolve(void queries.push(sql)) });
    await probe.check();
    expect(queries).toEqual(['SELECT 1']);
    expect(probe).toMatchObject({ name: 'db', critical: true, timeoutMs: 1_000 });
  });

  it('valkey: chưa ready ⇒ lỗi ngay (không ping); ready ⇒ ping; không critical', async () => {
    let pings = 0;
    const client = { isReady: false, ping: () => Promise.resolve(String(++pings)) };
    const probe = valkeyProbe(client);
    await expect(probe.check()).rejects.toThrow('not ready');
    expect(pings).toBe(0);
    client.isReady = true;
    await probe.check();
    expect(pings).toBe(1);
    expect(probe).toMatchObject({ name: 'valkey', critical: false, timeoutMs: 500 });
  });
});

describe('requireAllowedOrigin (endpoint dùng cookie — security.md §6.3)', () => {
  const app = express();
  app.post('/auth/refresh', requireAllowedOrigin(['https://app.example.com']), (_req, res) => {
    res.sendStatus(204);
  });
  app.use(
    globalErrorHandler({
      responder: new HttpResponder(new FakeClock()),
      logger: new SpyLogger(),
      exposeInternalErrors: false,
    }),
  );

  it('Origin trong whitelist ⇒ qua', async () => {
    expect(
      (await request(app).post('/auth/refresh').set('Origin', 'https://app.example.com')).status,
    ).toBe(204);
  });

  it.each([
    ['Origin lạ', 'https://evil.example'],
    ['thiếu Origin', undefined],
  ])('%s ⇒ 403 ORIGIN_NOT_ALLOWED', async (_label, origin) => {
    const req = request(app).post('/auth/refresh');
    const res = await (origin ? req.set('Origin', origin) : req);
    expect(res.status).toBe(403);
    expect(errorOf(res).code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('error handler — chi tiết', () => {
  it('toAppError: AppError giữ nguyên; giá trị lạ (kể cả không phải Error) ⇒ InternalError', () => {
    const known = new UnauthorizedError();
    expect(toAppError(known)).toBe(known);
    expect(toAppError('string thrown')).toBeInstanceOf(InternalError);
    expect(toAppError(null)).toBeInstanceOf(InternalError);
    expect(toAppError({ type: 'errorOf(unknown)' })).toBeInstanceOf(InternalError);
  });

  it('lỗi 5xx được log error kèm nguyên nhân; 4xx không log ở handler', async () => {
    const logger = new SpyLogger();
    const app = express();
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.get('/denied', () => {
      throw new UnauthorizedError();
    });
    app.use(
      globalErrorHandler({
        responder: new HttpResponder(new FakeClock()),
        logger,
        exposeInternalErrors: false,
      }),
    );
    await request(app).get('/denied');
    expect(logger.entries).toEqual([]);
    await request(app).get('/boom');
    expect(logger.entries).toMatchObject([
      { level: 'error', msg: 'http.unhandled_error', data: { code: 'INTERNAL_ERROR' } },
    ]);
    expect((logger.entries[0]?.data['err'] as Error).message).toBe('kaboom');
  });

  it('header đã gửi ⇒ chuyển cho Express (hủy kết nối, không ghi envelope chồng lên)', async () => {
    const app = express();
    app.get('/partial', (_req, res, next) => {
      res.write('partial');
      next(new Error('late'));
    });
    app.use(
      globalErrorHandler({
        responder: new HttpResponder(new FakeClock()),
        logger: new SpyLogger(),
        exposeInternalErrors: false,
      }),
    );
    await expect(request(app).get('/partial')).rejects.toThrow('aborted');
  });
});

describe('resolveRequestId', () => {
  it('chấp nhận uuid (chuẩn hóa chữ thường), lấy phần tử đầu nếu header lặp', () => {
    expect(resolveRequestId('3B241101-E2BB-4255-8CAF-4136C566A962')).toBe(
      '3b241101-e2bb-4255-8caf-4136c566a962',
    );
    expect(resolveRequestId(['3b241101-e2bb-4255-8caf-4136c566a962', 'x'])).toBe(
      '3b241101-e2bb-4255-8caf-4136c566a962',
    );
  });

  it('thiếu hoặc không phải uuid ⇒ sinh mới', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('../../etc/passwd')).not.toBe('../../etc/passwd');
  });
});
