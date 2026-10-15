// Gateway Socket.io wire qua composition root thật (T-021 bỏ stub T-016): xác thực bằng
// AccessTokenAuthenticator của auth, project:join bằng WorkspaceProjectAccessChecker, và use case
// HTTP (logout-all, xóa thành viên) gọi tới gateway sau commit qua LateBoundRealtime.
import type { AddressInfo } from 'node:net';

import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RealtimeGateway } from '../../src/core/realtime/gateway';
import { socketAuthenticatorFrom } from '../../src/core/realtime/ports';
import { createHttpServer, listen } from '../../src/server';
import { envelopeOf } from '../support/http';
import { createTestApp, WEB, type TestApp, type TestUser } from '../support/http-app';
import { SequentialIdGenerator } from '../support/time-and-ids';
import { SpyLogger } from '../support/spies';
import { connectError, connected, disconnected, emitWithAck, nextEvent } from '../support/realtime';

let t: TestApp;
let url: string;
let close: () => Promise<void>;
const sockets: Socket[] = [];

beforeEach(async () => {
  t = createTestApp();
  const server = createHttpServer(t.app);
  const gateway = new RealtimeGateway(server, {
    corsOrigins: [WEB],
    trustProxyHops: 0,
    authenticator: socketAuthenticatorFrom(t.container.auth.authenticator),
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
});

const connect = (token: string) => {
  const socket = io(url, {
    transports: ['websocket'],
    auth: { token },
    extraHeaders: { origin: WEB },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
};

async function firstProjectId(u: TestUser): Promise<string> {
  const res = await request(t.app).get(`/api/v1/workspaces/${u.workspaceId}/projects`).set(u.auth);
  return envelopeOf<{ id: string }[]>(res).data?.[0]?.id ?? '';
}

describe('gateway trên composition root thật', () => {
  it('access token thật từ /auth/register kết nối được; token rác bị từ chối', async () => {
    const alice = await t.register('Alice');
    await connected(connect(alice.token));
    expect((await connectError(connect('garbage'))).code).toBe('UNAUTHORIZED');
  });

  it('project:join dùng membership thật: project của mình ok, project workspace khác ⇒ RESOURCE_NOT_FOUND', async () => {
    const alice = await t.register('Alice');
    const bob = await t.register('Bob');
    const socket = connect(alice.token);
    await connected(socket);
    expect(
      await emitWithAck(socket, 'project:join', {
        workspaceId: alice.workspaceId,
        projectId: await firstProjectId(alice),
      }),
    ).toEqual({ ok: true });
    expect(
      await emitWithAck(socket, 'project:join', {
        workspaceId: bob.workspaceId,
        projectId: await firstProjectId(bob),
      }),
    ).toEqual({ ok: false, code: 'RESOURCE_NOT_FOUND' });
  });

  it('POST /auth/logout-all ngắt socket đang mở (use case → LateBoundRealtime → gateway, sau commit)', async () => {
    const alice = await t.register('Alice');
    const socket = connect(alice.token);
    await connected(socket);
    const gone = disconnected(socket);
    const res = await request(t.app)
      .post('/api/v1/auth/logout-all')
      .set(alice.auth)
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(204);
    expect(await gone).toBe('io server disconnect');
  });

  it('xóa thành viên qua HTTP ⇒ socket của họ rời phòng + nhận workspace:access-revoked', async () => {
    const alice = await t.register('Alice');
    const bob = await t.register('Bob');
    await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: bob.email, role: 'MEMBER' });
    const socket = connect(bob.token);
    await connected(socket);
    expect(
      await emitWithAck(socket, 'project:join', {
        workspaceId: alice.workspaceId,
        projectId: await firstProjectId(alice),
      }),
    ).toEqual({ ok: true });

    const revoked = nextEvent<{ actorId: string; data: { workspaceId: string } }>(
      socket,
      'workspace:access-revoked',
    );
    const res = await request(t.app)
      .delete(`/api/v1/workspaces/${alice.workspaceId}/members/${bob.id}`)
      .set(alice.auth);
    expect(res.status).toBe(200);
    expect(await revoked).toMatchObject({
      actorId: alice.id,
      data: { workspaceId: alice.workspaceId },
    });
  });
});
