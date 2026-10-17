import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { CLIENT_ERROR_CODES, createHttpClient, isApiError, type AuthHooks } from './index';

const BASE = 'http://localhost:4000/api/v1';
const CLIENT_ID = '0192f0a0-0000-7000-8000-000000000001';
const TS = '2026-10-17T03:00:00.000Z';

const okBody = (data: unknown) =>
  JSON.stringify({ success: true, data, meta: { timestamp: TS, requestId: 'req-1' } });
const failBody = (code: string) =>
  JSON.stringify({
    success: false,
    error: { code, message: `msg ${code}`, details: null },
    meta: { timestamp: TS, requestId: 'req-e' },
  });

/** Một lượt XHR giả: kịch bản chạy sau `send` (microtask), như trình duyệt thật. */
type Script = (x: FakeXhr) => void;

class FakeXhr {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  withCredentials = true;
  responseType = '';
  status = 0;
  responseText = '';
  rawHeaders = '';
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  constructor(private readonly script: Script) {}

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  getAllResponseHeaders() {
    return this.rawHeaders;
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => {
      if (!this.aborted) this.script(this);
    });
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  // --- điều khiển từ kịch bản ---
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(
    status: number,
    body: string,
    headers = 'Content-Type: application/json\r\nX-Request-Id: req-h\r\n',
  ) {
    this.status = status;
    this.responseText = body;
    this.rawHeaders = headers;
    this.onload?.();
  }
}

const respondOk =
  (data: unknown): Script =>
  (x) =>
    x.respond(200, okBody(data));
const respondFail =
  (status: number, code: string): Script =>
  (x) =>
    x.respond(status, failBody(code));

function setup(scripts: Script[], auth?: AuthHooks) {
  const queue = [...scripts];
  const made: FakeXhr[] = [];
  const xhr = vi.fn(() => {
    const script = queue.shift();
    if (!script) throw new Error('hết kịch bản XHR giả');
    const x = new FakeXhr(script);
    made.push(x);
    return x as unknown as XMLHttpRequest;
  });
  const http = createHttpClient({
    baseUrl: () => BASE,
    clientId: () => CLIENT_ID,
    fetch: vi.fn<typeof fetch>(() => Promise.reject(new Error('upload không được đi qua fetch'))),
    xhr,
    ...(auth ? { auth } : {}),
  });
  return { http, made };
}

function fakeAuth(overrides: Partial<AuthHooks> = {}) {
  let token: string | null = 'old';
  return {
    getAccessToken: vi.fn(() => token),
    refresh: vi.fn(() => {
      token = 'new';
      return Promise.resolve(true);
    }),
    onSessionEnded: vi.fn(),
    ...overrides,
  };
}

const Schema = z.object({ avatarUrl: z.string() });
const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

describe('http.upload — XHR nhị phân (avatar-chat.md ADR-141, §7 E2)', () => {
  it('2xx ⇒ data parse bằng schema; octet-stream, X-Upload-Name mã hóa, Bearer, X-Client-Id, không cookie', async () => {
    const auth = fakeAuth();
    const { http, made } = setup([respondOk({ avatarUrl: 'https://api/x' })], auth);
    const data = await http.upload('PUT', '/me/avatar', {
      schema: Schema,
      body: blob,
      name: 'Ảnh đẹp #1.jpg',
    });
    expect(data).toEqual({ avatarUrl: 'https://api/x' });
    const x = made[0]!;
    expect(x.method).toBe('PUT');
    expect(x.url).toBe(`${BASE}/me/avatar`);
    expect(x.body).toBe(blob);
    expect(x.withCredentials).toBe(false);
    expect(x.headers['content-type']).toBe('application/octet-stream');
    expect(x.headers['x-upload-name']).toBe(encodeURIComponent('Ảnh đẹp #1.jpg'));
    expect(x.headers['authorization']).toBe('Bearer old');
    expect(x.headers['x-client-id']).toBe(CLIENT_ID);
  });

  it('query ghép vào URL (vd ?as=image của chat)', async () => {
    const { http, made } = setup([respondOk({ avatarUrl: 'u' })]);
    await http.upload('POST', '/chat/uploads', {
      schema: Schema,
      body: blob,
      name: 'a.png',
      query: { as: 'image' },
    });
    expect(made[0]!.url).toBe(`${BASE}/chat/uploads?as=image`);
  });

  it('tiến độ 0 → phần → 1', async () => {
    const { http } = setup([
      (x) => {
        x.progress(50, 100);
        x.progress(100, 100);
        x.respond(200, okBody({ avatarUrl: 'u' }));
      },
    ]);
    const onProgress = vi.fn<(fraction: number) => void>();
    await http.upload('PUT', '/me/avatar', {
      schema: Schema,
      body: blob,
      name: 'a.jpg',
      onProgress,
    });
    expect(onProgress.mock.calls.map(([f]) => f)).toEqual([0, 0.5, 1, 1]);
  });

  it('204 ⇒ data undefined nếu schema cho phép', async () => {
    const { http } = setup([(x) => x.respond(204, 'bỏ qua')]);
    await expect(
      http.upload('PUT', '/x', { schema: z.undefined(), body: blob, name: 'a' }),
    ).resolves.toBeUndefined();
  });

  it('hủy giữa chừng ⇒ AbortError, KHÔNG kết thúc phiên', async () => {
    const auth = fakeAuth();
    const controller = new AbortController();
    const { http, made } = setup([() => controller.abort()], auth);
    const err = await http
      .upload('PUT', '/me/avatar', {
        schema: Schema,
        body: blob,
        name: 'a',
        signal: controller.signal,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
    expect(made[0]!.aborted).toBe(true);
    expect(auth.onSessionEnded).not.toHaveBeenCalled();
  });

  it('signal đã hủy trước khi gửi ⇒ AbortError, không tạo XHR', async () => {
    const controller = new AbortController();
    controller.abort();
    const { http, made } = setup([respondOk({ avatarUrl: 'u' })]);
    await expect(
      http.upload('PUT', '/me/avatar', {
        schema: Schema,
        body: blob,
        name: 'a',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(made).toHaveLength(0);
  });

  it('TOKEN_EXPIRED ⇒ refresh rồi gửi lại ĐÚNG 1 lần, cùng Blob, token mới, tiến độ báo lại từ 0', async () => {
    const auth = fakeAuth();
    const { http, made } = setup(
      [
        (x) => {
          x.progress(100, 100);
          x.respond(401, failBody('TOKEN_EXPIRED'));
        },
        respondOk({ avatarUrl: 'u2' }),
      ],
      auth,
    );
    const onProgress = vi.fn<(fraction: number) => void>();
    const data = await http.upload('PUT', '/me/avatar', {
      schema: Schema,
      body: blob,
      name: 'a',
      onProgress,
    });
    expect(data).toEqual({ avatarUrl: 'u2' });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(2);
    expect(made[1]!.body).toBe(blob);
    expect(made[1]!.headers['authorization']).toBe('Bearer new');
    expect(onProgress.mock.calls.map(([f]) => f)).toEqual([0, 1, 1, 0, 1]);
  });

  it('SESSION_REVOKED ⇒ onSessionEnded("revoked"), không refresh', async () => {
    const auth = fakeAuth();
    const { http } = setup([respondFail(401, 'SESSION_REVOKED')], auth);
    await expect(
      http.upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'a' }),
    ).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
    expect(auth.onSessionEnded).toHaveBeenCalledWith('revoked');
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('lỗi mạng / timeout ⇒ NETWORK_ERROR status 0, không kết thúc phiên', async () => {
    const auth = fakeAuth();
    const { http } = setup([(x) => x.onerror?.(), (x) => x.ontimeout?.()], auth);
    for (let i = 0; i < 2; i += 1) {
      const err = await http
        .upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'a' })
        .catch((e: unknown) => e);
      expect(isApiError(err) && err.status === 0 && err.code === CLIENT_ERROR_CODES.network).toBe(
        true,
      );
    }
    expect(auth.onSessionEnded).not.toHaveBeenCalled();
  });

  it('envelope lỗi có mã mới (STORAGE_FULL — contracts chưa có) ⇒ ApiError giữ status + serverCode', async () => {
    const { http } = setup([respondFail(507, 'STORAGE_FULL')]);
    await expect(
      http.upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'a' }),
    ).rejects.toMatchObject({ status: 507, serverCode: 'STORAGE_FULL' });
  });

  it('413 PAYLOAD_TOO_LARGE (mã đã có) ⇒ code giữ nguyên', async () => {
    const { http } = setup([respondFail(413, 'PAYLOAD_TOO_LARGE')]);
    await expect(
      http.upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'a' }),
    ).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('đang refresh ⇒ upload xếp hàng chờ, gửi bằng token mới', async () => {
    let release: (v: boolean) => void = () => undefined;
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
    const { http, made } = setup(
      [
        respondFail(401, 'TOKEN_EXPIRED'),
        respondOk({ avatarUrl: 'u' }),
        respondOk({ avatarUrl: 'u' }),
      ],
      auth,
    );
    // Request đầu kích hoạt refresh; upload gửi trong lúc refresh đang chạy phải chờ.
    const first = http.upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'a' });
    await vi.waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    const second = http.upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'b' });
    await Promise.resolve();
    expect(made).toHaveLength(1);
    release(true);
    await Promise.all([first, second]);
    expect(made.slice(1).map((x) => x.headers['authorization'])).toEqual([
      'Bearer new',
      'Bearer new',
    ]);
  });

  describe('refresh chủ động trước tệp lớn (TL chốt — T-072)', () => {
    it('token còn < minTokenValidityMs ⇒ refresh TRƯỚC, gửi bằng token mới, chỉ 1 lượt XHR', async () => {
      const auth = { ...fakeAuth(), expiresAt: () => Date.now() + 30_000 };
      const { http, made } = setup([respondOk({ avatarUrl: 'u' })], auth);
      await http.upload('POST', '/chat/uploads', {
        schema: Schema,
        body: blob,
        name: 'a.pdf',
        minTokenValidityMs: 60_000,
      });
      expect(auth.refresh).toHaveBeenCalledTimes(1);
      expect(made).toHaveLength(1);
      expect(made[0]!.headers['authorization']).toBe('Bearer new');
    });

    it('token còn lâu, hoặc không truyền minTokenValidityMs (avatar) ⇒ không refresh', async () => {
      const auth = { ...fakeAuth(), expiresAt: () => Date.now() + 10 * 60_000 };
      const soon = { ...fakeAuth(), expiresAt: () => Date.now() + 1_000 };
      const a = setup([respondOk({ avatarUrl: 'u' })], auth);
      await a.http.upload('POST', '/x', {
        schema: Schema,
        body: blob,
        name: 'a',
        minTokenValidityMs: 60_000,
      });
      const b = setup([respondOk({ avatarUrl: 'u' })], soon);
      await b.http.upload('PUT', '/me/avatar', { schema: Schema, body: blob, name: 'a' });
      expect(auth.refresh).not.toHaveBeenCalled();
      expect(soon.refresh).not.toHaveBeenCalled();
    });

    it('refresh trước lỗi (mạng) ⇒ vẫn gửi, không kết thúc phiên', async () => {
      const auth = {
        ...fakeAuth({ refresh: vi.fn(() => Promise.reject(new Error('mạng'))) }),
        expiresAt: () => Date.now() + 1_000,
      };
      const { http, made } = setup([respondOk({ avatarUrl: 'u' })], auth);
      await expect(
        http.upload('POST', '/x', {
          schema: Schema,
          body: blob,
          name: 'a',
          minTokenValidityMs: 60_000,
        }),
      ).resolves.toEqual({ avatarUrl: 'u' });
      expect(made).toHaveLength(1);
      expect(auth.onSessionEnded).not.toHaveBeenCalled();
    });
  });
});
