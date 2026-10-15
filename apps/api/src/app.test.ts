import { Writable } from 'node:stream';

import { applyVietnameseZodLocale, HealthzResponse } from '@taskflow/contracts';
import { Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';

import { errorOf, FakeClock, productionEnvVars, testEnvVars } from '../test/support';
import {
  leakedSecrets,
  prismaCheckViolation,
  prismaValidationError,
} from '../test/support/prisma-errors';
import { appConfigFromEnv, createApp, type AppConfig } from './app';
import { loadEnv } from './config/env';
import { requestContext } from './core/context/request-context';
import { VersionConflictError } from './core/errors';
import type { ReadinessProbe } from './core/http/health';
import { validate } from './core/http/validate';
import { createLogger } from './core/logging/pino-logger';

const ORIGIN = 'http://localhost:3000';
const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  gitSha: 'sha-1',
  corsOrigins: [ORIGIN],
  trustProxyHops: 0,
  production: false,
  hsts: false,
  bodyLimit: '1kb',
  ...overrides,
});

const TaskParams = z.object({ taskId: z.uuid() });
const Body = z.strictObject({ title: z.string().trim().min(3), password: z.string().optional() });
const Query = z.object({ limit: z.coerce.number().int().max(50).default(20) });

/** Logger gốc mà route `/whoami` dùng (mô phỏng use case không có `req.log`). */
let rootLogger: ReturnType<typeof createLogger> | undefined;

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
  router.get('/prisma-check', () => {
    throw prismaCheckViolation();
  });
  router.get('/prisma-validation', () => {
    throw prismaValidationError();
  });
  router.get('/whoami', (req, res) => {
    req.user = { id: 'user-1', sid: 'sid-1' }; // như `authenticate`
    (req as { log?: { info(o: object, m: string): void } }).log?.info({}, 'handler.req_log');
    rootLogger?.info({ event: 'use-case' }, 'use_case.root_log'); // logger gốc (như use case)
    res.json({ ok: true });
  });
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
  options: {
    production?: boolean;
    hsts?: boolean;
    probes?: ReadinessProbe[];
    shuttingDown?: boolean;
    logger?: ReturnType<typeof createLogger>;
  } = {},
) {
  return createApp({
    config: config({ production: options.production ?? false, hsts: options.hsts ?? false }),
    logger: options.logger ?? createLogger({ level: 'silent', gitSha: 'sha-1', appEnv: 'test' }),
    clock: new FakeClock('2026-10-15T08:00:00.000Z'),
    probes: options.probes ?? [probe('db', true, true), probe('valkey', false, true)],
    isShuttingDown: () => options.shuttingDown ?? false,
    apiRouter: testRouter(),
  });
}

const TASK = '/api/v1/tasks/0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a';

beforeAll(() => applyVietnameseZodLocale());

describe('appConfigFromEnv', () => {
  it('suy cấu hình HTTP từ Env đã validate (body limit 100kb cố định — ADR-028)', () => {
    const env = loadEnv(productionEnvVars({ GIT_SHA: 'abc' }));
    expect(appConfigFromEnv(env)).toEqual({
      gitSha: 'abc',
      corsOrigins: ['https://app.example.com'],
      trustProxyHops: 1,
      production: true,
      hsts: true,
      bodyLimit: '100kb',
      apiDocs: false, // A2: chỉ local/test
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

  it('HSTS 1 năm + includeSubDomains khi APP_ENV staging/production (ADR-101)', async () => {
    const res = await request(build({ hsts: true })).get('/healthz');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('ADR-101: HSTS theo APP_ENV, không theo NODE_ENV — local/test không bao giờ có HSTS', () => {
    const local = loadEnv(testEnvVars({ NODE_ENV: 'development', APP_ENV: 'local' }));
    expect(appConfigFromEnv(local).hsts).toBe(false);
    const staging = loadEnv(productionEnvVars({ APP_ENV: 'staging' }));
    expect(appConfigFromEnv(staging).hsts).toBe(true);
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

  it.each(['utf-7', 'utf-16le', 'UTF-16BE', '"iso-8859-1"'])(
    'JSON với charset=%s ⇒ 415 (RFC 8259: chỉ UTF-8 — QA F finding A5)',
    async (charset) => {
      const res = await request(build())
        .post(TASK)
        .set('Content-Type', `application/json; charset=${charset}`)
        .send('{"title":"abc"}');
      expect(res.status).toBe(415);
      expect(errorOf(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    },
  );

  it.each([
    'application/json; charset=utf-8; charset=utf-16le',
    'application/json; charset=utf-16le; charset=utf-8',
    'application/json; charset=utf-8 extra',
  ])(
    'charset lặp / không đọc được (%s) ⇒ 415 — body-parser lấy charset CUỐI (audit T-028 F4)',
    async (ct) => {
      const res = await request(build()).post(TASK).set('Content-Type', ct).send('{"title":"abc"}');
      expect(res.status).toBe(415);
    },
  );

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'application/json;charset="UTF-8"',
  ])('%s ⇒ chấp nhận', async (contentType) => {
    const res = await request(build())
      .post(TASK)
      .set('Content-Type', contentType)
      .send('{"title":"abc"}');
    expect(res.status).toBe(200);
  });

  it('DELETE có body JSON charset lạ ⇒ 415; DELETE không body ⇒ không cần Content-Type', async () => {
    const del = (ct?: string) => {
      const req = request(build()).delete('/api/v1/nope');
      return ct ? req.set('Content-Type', ct).send('{}') : req;
    };
    expect((await del('application/json; charset=utf-16le')).status).toBe(415);
    expect((await del()).status).toBe(404);
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
      message: 'db password=[REDACTED]',
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it.each([
    [
      'vi phạm CHECK (P2039, dữ liệu dòng trong cause.detail)',
      '/api/v1/prisma-check',
      'PrismaClientKnownRequestError',
    ],
    [
      'PrismaClientValidationError (message in tham số)',
      '/api/v1/prisma-validation',
      'PrismaClientValidationError',
    ],
  ])(
    'T-031 mục 0 — %s: log (qua logger của pino-http) và details.debug KHÔNG chứa email / hash',
    async (_label, path, name) => {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _enc, done) {
          lines.push(chunk.toString());
          done();
        },
      });
      const logger = createLogger({ level: 'info', gitSha: 'sha-1', appEnv: 'local' }, stream);
      const res = await request(build({ logger })).get(path);
      expect(res.status).toBe(500);
      expect(lines.some((l) => l.includes('http.unhandled_error'))).toBe(true);
      expect(leakedSecrets(lines.join(''))).toEqual([]);
      expect(errorOf(res).details?.debug).toMatchObject({ name });
      expect(leakedSecrets(res.body)).toEqual([]);
    },
  );

  it('route không tồn tại ⇒ 404 RESOURCE_NOT_FOUND trong envelope', async () => {
    const res = await request(build()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(errorOf(res)).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'route' },
    });
  });
});

describe('T-031 mục 5–8: lỗi client, no-store, access log', () => {
  function captured(options: { production?: boolean } = {}) {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    const logger = createLogger({ level: 'info', gitSha: 'sha-1', appEnv: 'test' }, stream);
    rootLogger = logger;
    const app = createApp({
      config: config({ production: options.production ?? false, trustProxyHops: 1 }),
      logger,
      clock: new FakeClock('2026-10-15T08:00:00.000Z'),
      probes: [],
      isShuttingDown: () => false,
      apiRouter: testRouter(),
    });
    return { app, lines };
  }

  it('L3: path không giải mã được (URIError) ⇒ 400 VALIDATION_ERROR, log warn http.client_error — không error', async () => {
    const { app, lines } = captured();
    const res = await request(app)
      .post('/api/v1/tasks/%E0%A4%A')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res.status).toBe(400);
    expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    expect(lines.filter((l) => l['level'] === 'error')).toEqual([]);
    expect(lines.some((l) => l['msg'] === 'http.client_error' && l['level'] === 'warn')).toBe(true);
  });

  it('L4: mọi response /api/v1 mặc định Cache-Control: no-store (thành công, lỗi, 404)', async () => {
    const { app } = captured();
    for (const path of ['/api/v1/context', '/api/v1/conflict', '/api/v1/nope']) {
      expect((await request(app).get(path)).headers['cache-control']).toBe('no-store');
    }
  });

  it('L5 + M3: access log ghi path (không query), ip thật sau trust proxy, userId, reqId; log của handler / logger gốc cũng có reqId + ip', async () => {
    const { app, lines } = captured();
    const res = await request(app)
      .get('/api/v1/whoami?q=mia@example.com')
      .set('X-Forwarded-For', '203.0.113.7');
    expect(res.status).toBe(200);
    const reqId = res.headers['x-request-id'];
    const access = lines.find((l) => l['msg'] === 'request completed');
    expect(access).toMatchObject({
      req: { method: 'GET', path: '/api/v1/whoami' },
      ip: '203.0.113.7',
      userId: 'user-1',
      reqId,
    });
    expect(JSON.stringify(lines)).not.toContain('mia@example.com');
    for (const msg of ['handler.req_log', 'use_case.root_log']) {
      expect(lines.find((l) => l['msg'] === msg)).toMatchObject({ reqId, ip: '203.0.113.7' });
    }
  });
});

describe('/healthz & /readyz (devops.md §6.2)', () => {
  it('healthz: 200 {status} (KHÔNG lộ gitSha — T-031), no-store, không đụng probe', async () => {
    const res = await request(build({ probes: [probe('db', true, false)] })).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(HealthzResponse.parse(res.body)).toEqual({ status: 'ok' }); // parity với contract
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

  it('M2 (T-031): kết quả probe dùng chung trong 1 giây — request đồng thời / liền nhau chung MỘT lần kiểm', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const slow: ReadinessProbe = {
      name: 'db',
      critical: true,
      timeoutMs: 1_000,
      check: () => {
        calls++;
        return new Promise<void>((resolve) => (release = resolve));
      },
    };
    const clock = new FakeClock('2026-10-15T08:00:00.000Z');
    const app = createApp({
      config: config(),
      logger: createLogger({ level: 'silent', gitSha: 'sha-1', appEnv: 'test' }),
      clock,
      probes: [slow],
      isShuttingDown: () => false,
    });
    const pending = Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .get('/readyz')
          .then((r) => r.status),
      ),
    );
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect(await pending).toEqual([200, 200, 200, 200, 200]);
    expect((await request(app).get('/readyz')).status).toBe(200);
    expect(calls).toBe(1);
    clock.advance(1_000);
    const next = request(app)
      .get('/readyz')
      .then((r) => r.status);
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect(await next).toBe(200);
    expect(calls).toBe(2);
  });

  it('M2 (T-031): quá 60 lần/phút/IP ⇒ 429 + Retry-After; cờ shutdown không bị cache', async () => {
    let shuttingDown = false;
    const clock = new FakeClock('2026-10-15T08:00:00.000Z');
    const app = createApp({
      config: config({ trustProxyHops: 1 }),
      logger: createLogger({ level: 'silent', gitSha: 'sha-1', appEnv: 'test' }),
      clock,
      probes: [probe('db', true, true)],
      isShuttingDown: () => shuttingDown,
    });
    const ready = (ip: string) => request(app).get('/readyz').set('X-Forwarded-For', ip);
    for (let i = 0; i < 59; i++) expect((await ready('203.0.113.1')).status).toBe(200);
    shuttingDown = true;
    expect((await ready('203.0.113.1')).status).toBe(503);
    const limited = await ready('203.0.113.1');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect((await ready('203.0.113.2')).status).toBe(503);
    clock.advance(60_001);
    expect((await ready('203.0.113.1')).status).toBe(503);
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
