import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// `GET leave/requests?mine=1` (Mốc 3.5 — cấp công ty) strict như server (ListLeaveRequestsQuery) + phân trang cursor.

const BASE = 'http://localhost:4000/api/v1';
const ORIGIN = 'http://localhost:4000';

async function setup() {
  const api = createMockApi(BASE, { now: () => Date.parse('2026-10-15T03:00:00.000Z') });
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return {
      status: response.status,
      body: (await response.json()) as {
        data: unknown[];
        meta: { page?: { hasMore: boolean; nextCursor: string | null } };
        error: { code: string };
      },
    };
  };
  const reg = await call('POST', '/auth/register', undefined, {
    email: 'lan@example.com',
    password: 'cay-tre-xanh-ven-song',
    fullName: 'Trần Lan',
  });
  const me = reg.body.data as unknown as { accessToken: string };
  return { call, token: me.accessToken };
}

describe('mock: đơn của tôi', () => {
  it('tham số lạ (userId — SEC-HR-03) hoặc limit > 100 ⇒ 400; trang có meta.page', async () => {
    const { call, token } = await setup();
    const path = '/leave/requests';
    const other = crypto.randomUUID();
    expect((await call('GET', `${path}?mine=1&userId=${other}`, token)).status).toBe(400);
    expect((await call('GET', `${path}?mine=1&limit=101`, token)).status).toBe(400);
    const ok = await call('GET', `${path}?mine=1&limit=50`, token);
    expect(ok.status).toBe(200);
    expect(ok.body.meta.page).toEqual({ hasMore: false, nextCursor: null, limit: 50 });
  });
});
