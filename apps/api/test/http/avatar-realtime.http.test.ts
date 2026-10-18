// T-068 AV-07 (ADR-142, R49): đổi / gỡ ảnh ⇒ `user:avatar-changed` {userId, avatarUrl 64} tới phòng `company` (mọi socket
// đã xác thực lại + qua cổng công ty), không mang `avatarUrlLarge`. Gateway thật + kho tệp tạm + sharp thật.
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFiles, type FilesBundle } from '../../src/composition/files-setup';
import { loadEnv } from '../../src/config/env';
import type { ILogger } from '../../src/core/logging/logger';
import { RealtimeGateway } from '../../src/core/realtime/gateway';
import { createHttpServer, listen } from '../../src/server';
import * as fx from '../security/harness/files/fixtures';
import { testEnvVars } from '../support';
import { createTestApp, WEB, type TestApp, type TestUser } from '../support/http-app';
import { connected, emitWithAck, nextEvent } from '../support/realtime';
import { SpyLogger } from '../support/spies';
import { SequentialIdGenerator } from '../support/time-and-ids';

const noop = () => undefined;
const quiet = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
} as unknown as ILogger;

let dir: string;
let files: FilesBundle;
let t: TestApp;
let url: string;
let close: () => Promise<void>;
const sockets: Socket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tf-avatar-rt-'));
  const env = loadEnv(testEnvVars({ FILE_STORE_DIR: dir, FILE_URL_SECRET: 'f'.repeat(40) }));
  files = await createFiles({
    env,
    clock: { now: () => new Date() },
    logger: quiet,
    webOrigin: WEB,
  });
  t = createTestApp({}, { files });
  const server = createHttpServer(t.app);
  const gateway = new RealtimeGateway(server, {
    corsOrigins: [WEB],
    trustProxyHops: 0,
    authenticator: t.container.socketAuth,
    accessChecker: t.container.workspace.accessChecker,
    logger: new SpyLogger(),
    clock: t.clock,
    ids: new SequentialIdGenerator(),
  });
  t.container.realtime.bind(gateway);
  await listen(server, 0, '127.0.0.1');
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
});

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await close();
  await files.close();
  await rm(dir, { recursive: true, force: true });
});

/** Kết nối + chờ xác thực lại xong (ack đầu tiên chỉ trả sau `verified` ⇒ đã ở phòng `company`). */
async function online(u: TestUser): Promise<Socket> {
  const socket = io(url, {
    transports: ['websocket'],
    auth: { token: u.token },
    extraHeaders: { origin: WEB },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  await connected(socket);
  await emitWithAck(socket, 'project:join', {
    workspaceId: u.workspaceId,
    projectId: u.workspaceId,
  });
  return socket;
}

type AvatarChanged = {
  type: string;
  actorId: string;
  data: { userId: string; avatarUrl: string | null };
};

describe('user:avatar-changed (AV-07)', () => {
  it('đặt ảnh ⇒ người khác trong công ty nhận {userId, avatarUrl 64}; gỡ ⇒ avatarUrl null', async () => {
    const mia = await t.register('Mia');
    const vic = await t.register('Vic'); // workspace khác — sự kiện là danh bạ cấp công ty
    const socket = await online(vic);

    const set = nextEvent<AvatarChanged>(socket, 'user:avatar-changed');
    const res = await request(t.app)
      .put('/api/v1/me/avatar')
      .set(mia.auth)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Upload-Name', 'a.png')
      .send(fx.png({ w: 8, h: 8 }));
    expect(res.status).toBe(200);
    const body = res.body as { data: { avatarUrl: string } };
    const ev = await set;
    expect([ev.type, ev.actorId]).toEqual(['user:avatar-changed', mia.id]);
    // đúng hai trường — không `avatarUrlLarge` (TL).
    expect(ev.data).toStrictEqual({ userId: mia.id, avatarUrl: body.data.avatarUrl });

    const removed = nextEvent<AvatarChanged>(socket, 'user:avatar-changed');
    await request(t.app).delete('/api/v1/me/avatar').set(mia.auth).expect(204);
    expect((await removed).data).toStrictEqual({ userId: mia.id, avatarUrl: null });
  });
});
