import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import {
  ApiError,
  CLIENT_ERROR_CODES,
  createHttpClient,
  isApiError,
  type AuthHooks,
} from './index';

const BASE = 'http://localhost:4000/api/v1';
const CLIENT_ID = '0192f0a0-0000-7000-8000-000000000001';

const TS = '2026-10-15T03:00:00.000Z';
const ok = (data: unknown, meta: object = { requestId: 'req-1' }, status = 200) =>
  new Response(JSON.stringify({ success: true, data, meta: { timestamp: TS, ...meta } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const fail = (status: number, code: string, details: unknown = null) =>
  new Response(
    JSON.stringify({
      success: false,
      error: { code, message: `msg ${code}`, details },
      meta: { timestamp: TS, requestId: 'req-e' },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function setup(
  responses: Array<Response | (() => Response | Promise<Response>)>,
  auth?: AuthHooks,
) {
  const queue = [...responses];
  const fetchMock: FetchMock = vi.fn<typeof fetch>(() => {
    const next = queue.shift();
    if (!next) throw new Error('hết response giả');
    return Promise.resolve(typeof next === 'function' ? next() : next);
  });
  const http = createHttpClient({
    baseUrl: () => BASE,
    clientId: () => CLIENT_ID,
    fetch: fetchMock,
    ...(auth ? { auth } : {}),
  });
  const call = (i: number) => {
    const [input, init] = fetchMock.mock.calls[i] ?? [];
    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.href : (input ?? '');
    return { url, init: init ?? {}, headers: new Headers(init?.headers) };
  };
  return { http, fetchMock, call };
}

function fakeAuth(overrides: Partial<AuthHooks> = {}) {
  let token: string | null = 'old';
  const auth = {
    getAccessToken: vi.fn(() => token),
    refresh: vi.fn(() => {
      token = 'new';
      return Promise.resolve(true);
    }),
    onSessionEnded: vi.fn(),
    ...overrides,
  };
  return auth;
}

const Item = z.object({ id: z.string() });

describe('http — request', () => {
  it('ghép baseUrl + path + query (bỏ undefined/null), trả data đã parse bằng schema', async () => {
    const { http, call } = setup([ok({ id: 'a', extra: 1 })]);
    const data = await http.get('/workspaces', {
      schema: Item,
      query: { limit: 50, cursor: undefined, q: null, archived: false },
    });
    expect(data).toEqual({ id: 'a' }); // field lạ bị strip theo schema
    expect(call(0).url).toBe(`${BASE}/workspaces?limit=50&archived=false`);
    expect(call(0).init.method).toBe('GET');
  });

  it('path không bắt đầu bằng "/" ⇒ lỗi lập trình', async () => {
    const { http } = setup([]);
    await expect(http.get('workspaces', { schema: Item })).rejects.toThrow(/bắt đầu bằng/);
  });

  it('POST: body JSON, Content-Type, X-Client-Id; GET không gửi X-Client-Id', async () => {
    const { http, call } = setup([ok({ id: 'a' }), ok({ id: 'b' })]);
    await http.post('/tasks', { schema: Item, body: { title: 'Viết test' } });
    await http.get('/tasks/b', { schema: Item });
    expect(call(0).init.body).toBe('{"title":"Viết test"}');
    expect(call(0).headers.get('Content-Type')).toBe('application/json');
    expect(call(0).headers.get('X-Client-Id')).toBe(CLIENT_ID);
    expect(call(1).headers.get('X-Client-Id')).toBeNull();
    expect(call(1).headers.get('Content-Type')).toBeNull();
  });

  it('credentials: include CHỈ cho /auth/* (cookie refresh), còn lại omit', async () => {
    const { http, call } = setup([ok({ id: 'a' }), ok({ id: 'b' })]);
    await http.post('/auth/refresh', { schema: Item });
    await http.get('/workspaces', { schema: Item });
    expect(call(0).init.credentials).toBe('include');
    expect(call(1).init.credentials).toBe('omit');
  });

  it('204 ⇒ data undefined nếu schema cho phép', async () => {
    const { http } = setup([new Response(null, { status: 204 })]);
    await expect(http.post('/auth/logout', { schema: z.undefined() })).resolves.toBeUndefined();
  });

  it('request() trả kèm meta.page và requestId', async () => {
    const page = { nextCursor: 'abc', hasMore: true, limit: 50 };
    const { http } = setup([ok([{ id: 'a' }], { requestId: 'r-9', page })]);
    const result = await http.request('GET', '/projects', { schema: z.array(Item) });
    expect(result).toEqual({ data: [{ id: 'a' }], page, requestId: 'r-9' });
  });
});

describe('http — lỗi có kiểu', () => {
  it('envelope lỗi ⇒ ApiError giữ status/code/message/details/requestId', async () => {
    const details = { issues: [{ path: ['title'], code: 'too_small', message: 'Quá ngắn' }] };
    const { http } = setup([fail(400, 'VALIDATION_ERROR', details)]);
    const error = await http.post('/tasks', { schema: Item, body: {} }).catch((e: unknown) => e);
    expect(isApiError(error, 'VALIDATION_ERROR')).toBe(true);
    expect(error).toMatchObject({
      status: 400,
      message: 'msg VALIDATION_ERROR',
      details,
      requestId: 'req-e',
    });
  });

  it('error.code lạ (API mới hơn web — ADR-102) ⇒ UNKNOWN_ERROR, giữ status/message/requestId', async () => {
    const { http } = setup([fail(422, 'SOMETHING_NEW')]);
    const error = await http.get('/x', { schema: Item }).catch((e: unknown) => e);
    expect(isApiError(error, CLIENT_ERROR_CODES.unknown)).toBe(true);
    expect(error).toMatchObject({
      status: 422,
      message: 'msg SOMETHING_NEW',
      requestId: 'req-e',
      serverCode: 'SOMETHING_NEW',
    });
  });

  it('error.code đã biết ⇒ giữ nguyên code, không có serverCode', async () => {
    const { http } = setup([fail(409, 'VERSION_CONFLICT')]);
    const error = await http.get('/x', { schema: Item }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'VERSION_CONFLICT', serverCode: undefined });
  });

  it('fetch ném lỗi ⇒ NETWORK_ERROR, status 0', async () => {
    const { http } = setup([
      () => {
        throw new TypeError('Failed to fetch');
      },
    ]);
    await expect(http.get('/x', { schema: Item })).rejects.toMatchObject({
      code: CLIENT_ERROR_CODES.network,
      status: 0,
    });
  });

  it('AbortError được ném lại nguyên dạng (không bọc thành NETWORK_ERROR)', async () => {
    const { http } = setup([
      () => {
        throw new DOMException('aborted', 'AbortError');
      },
    ]);
    await expect(http.get('/x', { schema: Item })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    ['không phải JSON (502 HTML từ proxy)', new Response('<html>502</html>', { status: 502 })],
    ['JSON nhưng sai envelope', new Response('{"foo":1}', { status: 200 })],
    ['data không khớp schema contracts', ok({ id: 123 })],
    [
      'envelope lỗi thiếu meta',
      new Response('{"success":false,"error":{"code":"X","message":"m","details":null}}', {
        status: 400,
      }),
    ],
    ['envelope thành công thiếu meta.requestId', ok({ id: 'a' }, { requestId: '' })],
  ])('%s ⇒ BAD_RESPONSE', async (_label, response) => {
    const { http } = setup([response]);
    const error = await http.get('/x', { schema: Item }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: CLIENT_ERROR_CODES.badResponse });
  });
});

describe('http — xác thực (hook để trống ở T-012, Phase 4 nối)', () => {
  it('gắn Bearer khi có access token', async () => {
    const auth = fakeAuth();
    const { http, call } = setup([ok({ id: 'a' })], auth);
    await http.get('/auth/me', { schema: Item });
    expect(call(0).headers.get('Authorization')).toBe('Bearer old');
  });

  it('TOKEN_EXPIRED ⇒ refresh rồi gửi lại ĐÚNG 1 lần với token mới', async () => {
    const auth = fakeAuth();
    const { http, call, fetchMock } = setup([fail(401, 'TOKEN_EXPIRED'), ok({ id: 'a' })], auth);
    await expect(http.get('/me', { schema: Item })).resolves.toEqual({ id: 'a' });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).headers.get('Authorization')).toBe('Bearer new');
  });

  it('TOKEN_EXPIRED lần 2 sau khi đã refresh ⇒ không lặp vô hạn, kết thúc phiên', async () => {
    const auth = fakeAuth();
    const { http, fetchMock } = setup(
      [fail(401, 'TOKEN_EXPIRED'), fail(401, 'TOKEN_EXPIRED')],
      auth,
    );
    await expect(http.get('/me', { schema: Item })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.onSessionEnded).toHaveBeenCalledWith('expired');
  });

  it('refresh thất bại ⇒ onSessionEnded("expired"), ném lỗi gốc', async () => {
    const auth = fakeAuth({ refresh: vi.fn(() => Promise.resolve(false)) });
    const { http } = setup([fail(401, 'TOKEN_EXPIRED')], auth);
    await expect(http.get('/me', { schema: Item })).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(auth.onSessionEnded).toHaveBeenCalledWith('expired');
  });

  it('refresh ném lỗi (mạng) ⇒ NETWORK_ERROR, KHÔNG kết thúc phiên, không treo', async () => {
    const auth = fakeAuth({ refresh: vi.fn(() => Promise.reject(new TypeError('offline'))) });
    const { http } = setup([fail(401, 'TOKEN_EXPIRED')], auth);
    await expect(http.get('/me', { schema: Item })).rejects.toMatchObject({
      code: CLIENT_ERROR_CODES.network,
      status: 0,
    });
    expect(auth.onSessionEnded).not.toHaveBeenCalled();
  });

  it('UNAUTHORIZED (tv lệch / sid thu hồi) ⇒ KHÔNG refresh, kết thúc phiên "revoked"', async () => {
    const auth = fakeAuth();
    const { http } = setup([fail(401, 'UNAUTHORIZED')], auth);
    await expect(http.get('/me', { schema: Item })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.onSessionEnded).toHaveBeenCalledWith('revoked');
  });

  it('UNAUTHORIZED khi chưa gửi token (khách) ⇒ không kết thúc phiên', async () => {
    const auth = fakeAuth({ getAccessToken: vi.fn(() => null) });
    const { http } = setup([fail(401, 'UNAUTHORIZED')], auth);
    await expect(http.get('/me', { schema: Item })).rejects.toBeInstanceOf(ApiError);
    expect(auth.onSessionEnded).not.toHaveBeenCalled();
  });

  it('lỗi 401 khác (INVALID_CREDENTIALS khi login) ⇒ không refresh, không kết thúc phiên', async () => {
    const auth = fakeAuth();
    const { http } = setup([fail(401, 'INVALID_CREDENTIALS')], auth);
    await expect(http.post('/auth/login', { schema: Item, body: {} })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.onSessionEnded).not.toHaveBeenCalled();
  });

  it('5 request đồng thời cùng TOKEN_EXPIRED ⇒ chỉ 1 lần refresh (single-flight)', async () => {
    let release!: (v: boolean) => void;
    const auth = fakeAuth({
      refresh: vi.fn(() => new Promise<boolean>((resolve) => (release = resolve))),
    });
    const responses = [
      ...Array.from({ length: 5 }, () => fail(401, 'TOKEN_EXPIRED')),
      ...Array.from({ length: 5 }, (_, i) => ok({ id: String(i) })),
    ];
    const { http, fetchMock } = setup(responses, auth);
    const pending = Array.from({ length: 5 }, () => http.get('/me', { schema: Item }));
    await vi.waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    release(true);
    await expect(Promise.all(pending)).resolves.toHaveLength(5);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('TOKEN_EXPIRED về SAU khi request khác đã refresh xong ⇒ gửi lại bằng token mới, không refresh lần 2', async () => {
    let token = 'old';
    const auth = fakeAuth({ getAccessToken: vi.fn(() => token) });
    const { http, call } = setup(
      [
        () => {
          token = 'new'; // request khác refresh xong trong lúc request này đang bay
          return fail(401, 'TOKEN_EXPIRED');
        },
        ok({ id: 'a' }),
      ],
      auth,
    );
    await expect(http.get('/a', { schema: Item })).resolves.toEqual({ id: 'a' });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(call(1).headers.get('Authorization')).toBe('Bearer new');
  });

  it('request mới gửi trong lúc đang refresh ⇒ xếp hàng chờ, gửi bằng token mới', async () => {
    let release!: (v: boolean) => void;
    let token = 'old';
    const auth = fakeAuth({
      getAccessToken: vi.fn(() => token),
      refresh: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            release = (v) => {
              token = 'new';
              resolve(v);
            };
          }),
      ),
    });
    const { http, call, fetchMock } = setup(
      [fail(401, 'TOKEN_EXPIRED'), ok({ id: 'b' }), ok({ id: 'a' })],
      auth,
    );
    const first = http.get('/a', { schema: Item });
    await vi.waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    const second = http.get('/b', { schema: Item });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1); // /b chưa gửi khi refresh chưa xong
    release(true);
    await Promise.all([first, second]);
    expect(call(1).headers.get('Authorization')).toBe('Bearer new');
    expect(call(2).headers.get('Authorization')).toBe('Bearer new');
  });
});
