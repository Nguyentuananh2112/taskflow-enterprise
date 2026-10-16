// Test bổ sung theo kết quả mutation testing của QA F (docs/reviews/T-017-findings.md §B.3, core/http).
// Mỗi test ghi rõ đột biến sống mà nó giết.
import { Writable } from 'node:stream';

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { FakeClock, SpyLogger } from '../../../test/support';
import { requestContext } from '../context/request-context';
import { ServiceUnavailableError, UnsupportedMediaTypeError, ValidationError } from '../errors';
import { createLogger } from '../logging/pino-logger';
import { decodeCursor } from './cursor';
import { HttpResponder } from './envelope';
import { globalErrorHandler, toAppError } from './error-handler';
import { healthRouter } from './health';
import {
  jsonBody,
  requestLogging,
  requireJsonContentType,
  resolveRequestId,
  securityHeaders,
} from './middleware';
import { validate } from './validate';
import { validationErrorFromZod } from './zod';

const WEB = 'http://localhost:3001';
const UUID = '3b241101-e2bb-4255-8caf-4136c566a962';

function errorHandler(logger = new SpyLogger(), exposeInternalErrors = false) {
  return globalErrorHandler({
    responder: new HttpResponder(new FakeClock()),
    logger,
    exposeInternalErrors,
  });
}

/** App tối thiểu với chuỗi middleware HTTP thật của core. */
function app(
  routes: (a: express.Express) => void,
  opts: { logger?: SpyLogger; expose?: boolean } = {},
) {
  const a = express();
  a.use(...securityHeaders({ corsOrigins: [WEB], hsts: false }));
  a.use(requireJsonContentType);
  a.use(jsonBody('1kb'));
  routes(a);
  a.use(errorHandler(opts.logger, opts.expose));
  return a;
}

const echo: RequestHandler = (req, res) => {
  res.json({ body: req.body as unknown });
};

describe('pino-http: dòng log request chỉ có các trường an toàn (P1, middleware.ts:37-43)', () => {
  it('req = {id, method, path}, res = {statusCode} — không header nào (Authorization, Cookie, X-Api-Key…) lọt log', async () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _e, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    const logger = createLogger({ level: 'info', gitSha: 't', appEnv: 'test' }, sink);
    const a = express();
    a.use(...requestLogging(logger));
    a.get('/x', (_req, res) => {
      res.json({ ok: true });
    });
    await request(a)
      .get('/x?q=1')
      .set('Authorization', 'Bearer secret-token')
      .set('Cookie', 'tf_rt=secret-cookie')
      .set('X-Api-Key', 'secret-key');
    const entry = lines.find((l) => l['msg'] === 'request completed');
    expect(entry).toBeDefined();
    // T-031 (L5): chỉ path, không query string.
    expect(entry?.['req']).toMatchObject({ method: 'GET', path: '/x' });
    expect(Object.keys(entry?.['req'] as object).sort()).toEqual(['id', 'method', 'path']);
    expect(entry?.['res']).toEqual({ statusCode: 200 });
    expect(JSON.stringify(lines)).not.toMatch(/secret-(token|cookie|key)/);
  });

  it('mức log: 5xx ⇒ error, 4xx ⇒ warn, 2xx ⇒ info (cảnh báo vận hành dựa vào level — P3)', async () => {
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _e, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    const a = express();
    a.use(...requestLogging(createLogger({ level: 'info', gitSha: 't', appEnv: 'test' }, sink)));
    a.get('/s/:code', (req, res) => {
      res.sendStatus(Number(req.params.code));
    });
    for (const code of [200, 404, 503]) await request(a).get(`/s/${code}`);
    const levels = lines
      .filter((l) => l['req'])
      .map((l) => [(l['res'] as { statusCode: number }).statusCode, l['level']]);
    expect(levels).toEqual([
      [200, 'info'],
      [404, 'warn'],
      [503, 'error'],
    ]);
  });
});

describe('X-Request-Id (P1, middleware.ts:13 — neo ^…$)', () => {
  it.each([`evil${UUID}`, `${UUID}evil`, `${UUID}\r\nX-Injected: 1`])(
    'uuid bị bọc rác (%s) ⇒ sinh id mới, không phản chiếu',
    (raw) => {
      const id = resolveRequestId(raw);
      expect(id).not.toBe(raw);
      expect(id).not.toBe(UUID);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('request-context get() trả đúng ngữ cảnh (P3)', () => {
    expect(requestContext.run({ requestId: 'r' }, () => requestContext.get())).toEqual({
      requestId: 'r',
    });
    expect(requestContext.get()).toBeUndefined();
  });
});

describe('Content-Type & body (P1/P2)', () => {
  it.each(['PATCH', 'PUT'] as const)(
    '%s với Content-Type text/plain ⇒ 415 (security §6.3)',
    async (method) => {
      const a = app((x) => {
        x.patch('/r', echo);
        x.put('/r', echo);
      });
      const res = await request(a)
        [method === 'PATCH' ? 'patch' : 'put']('/r')
        .set('Content-Type', 'text/plain')
        .send('x');
      expect(res.status).toBe(415);
    },
  );

  it('khoảng trắng trước ";" (application/json ; charset=utf-8) vẫn hợp lệ', async () => {
    const a = app((x) => x.post('/r', echo));
    const res = await request(a)
      .post('/r')
      .set('Content-Type', 'application/json ; charset=utf-8')
      .send('{"a":1}');
    expect(res.status).toBe(200);
  });

  it('JSON gốc nguyên thủy ("chuỗi") ⇒ 400 (strict); object được parse đúng như gửi', async () => {
    const a = app((x) => x.post('/r', echo));
    const primitive = await request(a)
      .post('/r')
      .set('Content-Type', 'application/json')
      .send('"chuỗi"');
    expect(primitive.status).toBe(400);
    const ok = await request(a)
      .post('/r')
      .send({ a: 1, b: [true, null], c: { d: 'x' } });
    expect(ok.body).toEqual({ body: { a: 1, b: [true, null], c: { d: 'x' } } });
  });

  it('Content-Encoding không hỗ trợ ⇒ 415 (không phải 500) — translator encoding.unsupported', async () => {
    const a = app((x) => x.post('/r', echo));
    const res = await request(a)
      .post('/r')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{}');
    expect(res.status).toBe(415);
  });

  it('translator charset.unsupported / encoding.unsupported ⇒ UnsupportedMediaTypeError', () => {
    expect(toAppError({ type: 'charset.unsupported' })).toBeInstanceOf(UnsupportedMediaTypeError);
    expect(toAppError({ type: 'encoding.unsupported' })).toBeInstanceOf(UnsupportedMediaTypeError);
  });
});

describe('CORS (P2, middleware.ts:77,79)', () => {
  it('preflight: Allow-Methods = GET,POST,PUT,PATCH,DELETE; Max-Age 600', async () => {
    const a = app((x) => x.get('/r', echo));
    const res = await request(a)
      .options('/r')
      .set('Origin', WEB)
      .set('Access-Control-Request-Method', 'PATCH');
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('request thường: Expose-Headers gồm X-Request-Id, Retry-After, RateLimit-Policy, RateLimit (FE đọc Retry-After)', async () => {
    const a = app((x) => x.get('/r', echo));
    const res = await request(a).get('/r').set('Origin', WEB);
    expect(res.headers['access-control-expose-headers']).toBe(
      'X-Request-Id,Retry-After,RateLimit-Policy,RateLimit',
    );
  });
});

describe('error handler (P2, error-handler.ts:79,86,92)', () => {
  it('header đã gửi ⇒ chuyển cho Express, handler KHÔNG cố ghi envelope (không log 5xx)', async () => {
    const logger = new SpyLogger();
    const a = app(
      (x) =>
        x.get('/r', (_req, res, next) => {
          res.write('partial');
          next(new Error('late'));
        }),
      { logger },
    );
    await expect(request(a).get('/r')).rejects.toThrow();
    expect(logger.messages('error')).toEqual([]);
  });

  it('lỗi 5xx KHÔNG có cause vẫn được log kèm chính lỗi đó', async () => {
    const logger = new SpyLogger();
    const a = app(
      (x) =>
        x.get('/r', () => {
          throw new ServiceUnavailableError('db down');
        }),
      { logger },
    );
    expect((await request(a).get('/r')).status).toBe(503);
    const err = logger.entries.find((e) => e.msg === 'http.unhandled_error')?.data['err'];
    expect(err).toBeInstanceOf(ServiceUnavailableError);
  });

  it('throw giá trị không phải Error ở dev (exposeInternalErrors) ⇒ 500 envelope JSON, không sập handler', async () => {
    const a = app(
      (x) =>
        x.get('/r', () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- mô phỏng thư viện ném chuỗi
          throw 'boom';
        }),
      { expose: true },
    );
    const res = await request(a).get('/r');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect((res.body as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
  });
});

describe('cursor, validate, zod, health (P2/P3)', () => {
  it.each(['5', '"s"', 'true'])(
    'cursor là JSON nguyên thủy %s ⇒ ValidationError (không TypeError ⇒ 500)',
    (json) => {
      const raw = Buffer.from(json).toString('base64url');
      expect(() => decodeCursor(raw, 'k', z.object({}))).toThrow(ValidationError);
    },
  );

  it('validate chỉ với body; hai validate liên tiếp trên cùng body không ném "Cannot redefine property"', async () => {
    const a = app((x) =>
      x.post(
        '/r',
        validate({ body: z.object({ a: z.number() }) }),
        validate({ body: z.object({ a: z.number() }) }),
        echo,
      ),
    );
    expect((await request(a).post('/r').send({ a: 1 })).body).toEqual({ body: { a: 1 } });
  });

  it('path issue chứa chỉ số mảng là số (không phải chuỗi "0")', () => {
    const result = z.array(z.string()).safeParse([1]);
    if (result.success) throw new Error('phải lỗi');
    expect(validationErrorFromZod(result.error).issues[0]?.path).toEqual([0]);
  });

  it('/readyz: no-store và không rò timer sau khi probe xong', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const a = express().use(
        healthRouter({
          probes: [
            { name: 'db', critical: true, timeoutMs: 1_000, check: () => Promise.resolve() },
          ],
          isShuttingDown: () => false,
        }),
      );
      const res = await request(a).get('/readyz');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
