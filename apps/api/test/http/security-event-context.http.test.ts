// X9 (T-032) + mixin request context của A (T-031): sự kiện bảo mật ghi qua logger gốc trong use case
// vẫn mang `reqId` (= X-Request-Id) và `ip` (sau trust proxy) — điều tra được theo request / nguồn.
import { Writable } from 'node:stream';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, PASSWORD, type TestApp } from '../support/http-app';

let t: TestApp;
let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = [];
  const logDestination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(l) as Record<string, unknown>);
      }
      cb();
    },
  });
  t = createTestApp({}, { logDestination });
});

const IP = '203.0.113.42';
const event = (msg: string) => lines.find((l) => l['msg'] === msg);

describe('sự kiện bảo mật có reqId + ip', () => {
  it('auth.login_failed (use case, logger gốc) ⇒ reqId của response + ip thật; không có email', async () => {
    await t.register('Mia');
    const res = await request(t.app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', IP)
      .set('Content-Type', 'application/json')
      .send({ email: 'mia@example.com', password: `${PASSWORD}-wrong` });
    expect(res.status).toBe(401);
    expect(event('auth.login_failed')).toMatchObject({
      reqId: res.headers['x-request-id'],
      ip: IP,
    });
    expect(JSON.stringify(event('auth.login_failed'))).not.toContain('mia@example.com');
  });

  it('member.added (sau commit) ⇒ reqId + ip', async () => {
    const alice = await t.register('Alice');
    const nina = await t.register('Nina');
    const res = await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set({ ...alice.auth, 'X-Forwarded-For': IP })
      .send({ userId: nina.id, role: 'MEMBER' });
    expect(res.status).toBe(201);
    expect(event('member.added')).toMatchObject({ reqId: res.headers['x-request-id'], ip: IP });
  });
});
