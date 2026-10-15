import { Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';

import { errorOf, FakeClock, productionEnvVars } from '../test/support';
import { appConfigFromEnv, createApp, type AppConfig } from './app';
import { loadEnv } from './config/env';
import { requestContext } from './core/context/request-context';
import { VersionConflictError } from './core/errors';
import type { ReadinessProbe } from './core/http/health';
import { validate } from './core/http/validate';
import { configureZodLocale } from './core/http/zod';
import { createLogger } from './core/logging/pino-logger';

const ORIGIN = 'http://localhost:3000';
const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  gitSha: 'sha-1',
  corsOrigins: [ORIGIN],
  trustProxyHops: 0,
  production: false,
  bodyLimit: '1kb',
  ...overrides,
});

const TaskParams = z.object({ taskId: z.uuid() });
const Body = z.strictObject({ title: z.string().trim().min(3), password: z.string().optional() });
const Query = z.object({ limit: z.coerce.number().int().max(50).default(20) });

function testRouter(): Router {
  const router = Router();
  router.post(
    '/tasks/:taskId',
    validate({ params: TaskParams, body: Body, query: Query }),
    (req, res) => {
      res.json({ params: req.params, body: req.body as unknown, query: req.query });
    },
  );
  router.get('/conflict', () => {
    throw new VersionConflictError(4, { id: 't' });
  });
  router.get('/async-crash', async () => {
    await Promise.resolve();
    throw new Error('db password=hunter2');
  });
  router.get('/zod', () => z.object({ a: z.string() }).parse({}));
  router.get('/context', (_req, res) => {
    res.json({ requestId: requestContext.requestId() });
  });
  return router;
}

const probe = (name: string, critical: boolean, ok: boolean): ReadinessProbe => ({
  name,
  critical,
  timeoutMs: 50,
  check: () => (ok ? Promise.resolve() : Promise.reject(new Error('down'))),
});

function build(
  options: { production?: boolean; probes?: ReadinessProbe[]; shuttingDown?: boolean } = {},
) {
  return createApp({
    config: config({ production: options.production ?? false }),
    logger: createLogger({ level: 'silent', gitSha: 'sha-1', appEnv: 'test' }),
    clock: new FakeClock('2026-10-15T08:00:00.000Z'),
    probes: options.probes ?? [probe('db', true, true), probe('valkey', false, true)],
    isShuttingDown: () => options.shuttingDown ?? false,
    apiRouter: testRouter(),
  });
}

const TASK = '/api/v1/tasks/0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a';

beforeAll(() => configureZodLocale());

describe('appConfigFromEnv', () => {
  it('suy cấu hình HTTP từ Env đã validate (body limit 100kb cố định — ADR-028)', () => {
    const env = loadEnv(productionEnvVars({ GIT_SHA: 'abc' }));
    expect(appConfigFromEnv(env)).toEqual({
      gitSha: 'abc',
      corsOrigins: ['https://app.example.com'],
      trustProxyHops: 1,
      production: true,
      bodyLimit: '100kb',
    });
  });
});

describe('requestId', () => {
  it('sinh mới nếu thiếu, trả trong header và meta, có trong AsyncLocalStorage', async () => {
    const res = await request(build()).get('/api/v1/context');
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toEqual({ requestId: id });
  });

  it('giữ X-Request-Id hợp lệ của client, thay giá trị không phải uuid', async () => {
    const mine = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(
      (await request(build()).get('/healthz').set('X-Request-Id', mine)).headers['x-request-id'],
    ).toBe(mine);
    const evil = await request(build()).get('/healthz').set('X-Request-Id', '<script>x</script>');
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('header bảo mật (security.md §6.2–6.3)', () => {
  it('helmet: CSP none, nosniff, no-referrer, CORP same-site, không x-powered-by, không HSTS ngoài prod', async () => {
    const res = await request(build()).get('/healthz');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('HSTS 1 năm + includeSubDomains ở production', async () => {
    const res = await request(build({ production: true })).get('/healthz');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('CORS: origin trong whitelist được phản hồi kèm credentials; origin lạ không', async () => {
    const ok = await request(build())
      .options('/api/v1/context')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH');
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-headers']).toBe(
      'Content-Type,Authorization,X-Request-Id,X-Client-Id',
    );
    const bad = await request(build())
      .options('/api/v1/context')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'PATCH');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('body & Content-Type', () => {
  it('POST không phải application/json ⇒ 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(build())
      .post(TASK)
      .set('Content-Type', 'text/plain')
      .send('title=abc');
    expect(res.status).toBe(415);
    expect(errorOf(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('POST thiếu Content-Type (không body) ⇒ 415 — buộc preflight', async () => {
    expect((await request(build()).post(TASK)).status).toBe(415);
  });

  it('vượt body limit ⇒ 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(build())
      .post(TASK)
      .send({ title: 'x'.repeat(2_000) });
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('JSON hỏng ⇒ 400 VALIDATION_ERROR invalid_json', async () => {
    const res = await request(build())
      .post(TASK)
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.issues?.[0]?.code).toBe('invalid_json');
  });
});

describe('validate(schemas)', () => {
  it('thay params/query/body bằng giá trị đã parse (trim, coerce, default)', async () => {
    const res = await request(build()).post(`${TASK}?limit=5`).send({ title: '  Viết test  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { taskId: '0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a' },
      body: { title: 'Viết test' },
      query: { limit: 5 },
    });
  });

  it('param không phải uuid ⇒ 400 trước khi đọc body', async () => {
    const res = await request(build()).post('/api/v1/tasks/abc').send({ title: 'ok!' });
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.issues?.[0]).toMatchObject({
      path: ['taskId'],
      code: 'invalid_format',
    });
  });

  it('field lạ (mass assignment) bị từ chối; không phản chiếu input (ADR-096); message tiếng Việt (ADR-081)', async () => {
    const res = await request(build())
      .post(TASK)
      .send({ title: 'ab', password: 'hunter2-secret', role: 'OWNER' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2-secret');
    const issues = errorOf(res).details?.issues as {
      path: string[];
      code: string;
      message: string;
    }[];
    expect(issues.map((i) => i.code).sort()).toEqual(['too_small', 'unrecognized_keys']);
    expect(Object.keys(issues[0] ?? {}).sort()).toEqual(['code', 'message', 'path']);
    expect(issues.find((i) => i.code === 'too_small')?.message).toMatch(/[ýảạăâđêôơưà]/);
  });

  it('query sai ⇒ 400', async () => {
    expect((await request(build()).post(`${TASK}?limit=500`).send({ title: 'abc' })).status).toBe(
      400,
    );
  });
});

describe('error handler (đa hình)', () => {
  it('AppError ⇒ status + envelope lỗi đúng code/details', async () => {
    const res = await request(build()).get('/api/v1/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VERSION_CONFLICT',
        message: expect.any(String) as string,
        details: { currentVersion: 4, current: { id: 't' } },
      },
      meta: {
        timestamp: '2026-10-15T08:00:00.000Z',
        requestId: res.headers['x-request-id'] as string,
      },
    });
  });

  it('ZodError ném từ handler ⇒ 400 VALIDATION_ERROR', async () => {
    const res = await request(build()).get('/api/v1/zod');
    expect(res.status).toBe(400);
    expect(errorOf(res).details?.issues?.[0]?.path).toEqual(['a']);
  });

  it('lỗi lạ trong handler async (Express 5) ⇒ 500, prod không lộ message/stack', async () => {
    const res = await request(build({ production: true })).get('/api/v1/async-crash');
    expect(res.status).toBe(500);
    expect(errorOf(res)).toEqual({
      code: 'INTERNAL_ERROR',
      message: expect.any(String) as string,
      details: null,
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('ngoài production, lỗi 500 kèm details.debug để gỡ lỗi', async () => {
    const res = await request(build()).get('/api/v1/async-crash');
    expect(errorOf(res).details?.debug).toMatchObject({
      name: 'Error',
      message: 'db password=hunter2',
    });
  });

  it('route không tồn tại ⇒ 404 RESOURCE_NOT_FOUND trong envelope', async () => {
    const res = await request(build()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(errorOf(res)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'route' },
    });
  });
});

describe('/healthz & /readyz (devops.md §6.2)', () => {
  it('healthz: 200 {status, gitSha}, no-store, không đụng probe', async () => {
    const res = await request(build({ probes: [probe('db', true, false)] })).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', gitSha: 'sha-1' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['mọi thứ ổn', [true, true], false, 200, { db: 'ok', valkey: 'ok' }],
    [
      'Valkey lỗi ⇒ vẫn 200, degraded (ADR-074)',
      [true, false],
      false,
      200,
      { db: 'ok', valkey: 'degraded' },
    ],
    ['DB lỗi ⇒ 503', [false, true], false, 503, { db: 'down', valkey: 'ok' }],
    [
      'đang shutdown ⇒ 503',
      [true, true],
      true,
      503,
      { db: 'ok', valkey: 'ok', shuttingDown: true },
    ],
  ] as const)('%s', async (_label, [dbOk, valkeyOk], shuttingDown, status, body) => {
    const app = build({
      probes: [probe('db', true, dbOk), probe('valkey', false, valkeyOk)],
      shuttingDown,
    });
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(status);
    expect(res.body).toEqual(body);
  });

  it('probe treo quá timeout ⇒ coi như lỗi', async () => {
    const hang: ReadinessProbe = {
      name: 'db',
      critical: true,
      timeoutMs: 20,
      check: () => new Promise(() => undefined),
    };
    const res = await request(build({ probes: [hang] })).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ db: 'down' });
  });
});
