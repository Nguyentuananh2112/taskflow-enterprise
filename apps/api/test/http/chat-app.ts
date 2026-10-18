// Dựng app HTTP có module chat (T-069): kho tệp tạm + sharp thật; dọn sau mỗi test.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AddressInfo } from 'node:net';

import { io, type Socket } from 'socket.io-client';
import request from 'supertest';

import type { ChatSettings } from '../../src/composition/chat-wiring';
import { createFiles, type FilesBundle } from '../../src/composition/files-setup';
import { loadEnv } from '../../src/config/env';
import type { ILogger } from '../../src/core/logging/logger';
import { testEnvVars } from '../support';
import { envelopeOf } from '../support/http';
import { RealtimeGateway } from '../../src/core/realtime/gateway';
import { createHttpServer, listen } from '../../src/server';
import { createTestApp, WEB, type TestApp, type TestUser } from '../support/http-app';
import { connected, emitWithAck } from '../support/realtime';
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

export interface ChatApp {
  t: TestApp;
  files: FilesBundle;
  dir: string;
  close(): Promise<void>;
}

export async function chatApp(chat?: ChatSettings): Promise<ChatApp> {
  const dir = await mkdtemp(join(tmpdir(), 'tf-chat-http-'));
  const env = loadEnv(testEnvVars({ FILE_STORE_DIR: dir, FILE_URL_SECRET: 'f'.repeat(40) }));
  const files = await createFiles({
    env,
    clock: { now: () => new Date() },
    logger: quiet,
    webOrigin: 'http://w',
  });
  const t = createTestApp({}, { files, ...(chat ? { chat } : {}) });
  return {
    t,
    files,
    dir,
    close: async () => {
      await files.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export const api = (t: TestApp) => ({
  get: (by: TestUser, path: string) => request(t.app).get(`/api/v1${path}`).set(by.auth),
  delete: (by: TestUser, path: string) => request(t.app).delete(`/api/v1${path}`).set(by.auth),
  send: (by: TestUser, method: 'post' | 'put' | 'patch', path: string, body: object = {}) =>
    request(t.app)
      [method](`/api/v1${path}`)
      .set(by.auth)
      .set('Content-Type', 'application/json')
      .send(body),
  upload: (by: TestUser, body: Buffer, name: string, as: 'image' | 'file') =>
    request(t.app)
      .post(`/api/v1/chat/uploads?as=${as}`)
      .set(by.auth)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Upload-Name', encodeURIComponent(name))
      .send(body),
});

export const dataOf = <T>(res: request.Response) => envelopeOf<T>(res).data as T;

export const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

let seq = 0;
/** clientMsgId mới mỗi lần (uuid v4 hợp lệ). */
export const nextMsgId = () => `00000000-0000-4000-8000-${(++seq).toString().padStart(12, '0')}`;

/** Gateway thật trên app chat (T-070): `online(u)` = socket đã xác thực lại xong (ack đầu chỉ trả sau `verified`). */
export async function chatGateway(t: TestApp) {
  const server = createHttpServer(t.app);
  const gateway = new RealtimeGateway(server, {
    corsOrigins: [WEB],
    trustProxyHops: 0,
    ...t.container.gateway,
    logger: new SpyLogger(),
    clock: t.clock,
    ids: new SequentialIdGenerator(),
  });
  t.container.realtime.bind(gateway);
  await listen(server, 0, '127.0.0.1');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  return {
    async online(u: TestUser): Promise<Socket> {
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
    },
    async close() {
      sockets.splice(0).forEach((s) => s.close());
      await gateway.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
