// `project:updated` (data-and-api §615): server PHẢI phát sau update / archive / unarchive project —
// mock web đã phát từ T-034, server thì chưa (review bảo mật T-034, M1). Kiểm envelope bằng schema
// hợp đồng `ProjectUpdatedEvent`; chỉ phòng project, không lọt sang workspace khác.
import type { AddressInfo } from 'node:net';

import { ProjectUpdatedEvent } from '@taskflow/contracts';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RealtimeGateway } from '../../src/core/realtime/gateway';
import { socketAuthenticatorFrom } from '../../src/core/realtime/ports';
import { createHttpServer, listen } from '../../src/server';
import { envelopeOf } from '../support/http';
import { createTestApp, WEB, type TestApp, type TestUser } from '../support/http-app';
import { nextEvent, noEvent, connected, emitWithAck } from '../support/realtime';
import { SpyLogger } from '../support/spies';
import { SequentialIdGenerator } from '../support/time-and-ids';

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

describe('project:updated qua gateway thật', () => {
  async function setupRoom() {
    const alice = await t.register('Alice');
    const bob = await t.register('Bob');
    const carol = await t.register('Carol'); // workspace khác
    await request(t.app)
      .post(`/api/v1/workspaces/${alice.workspaceId}/members`)
      .set(alice.auth)
      .send({ email: bob.email, role: 'VIEWER' });
    const projectId = await firstProjectId(alice);
    const bobSocket = connect(bob.token);
    const carolSocket = connect(carol.token);
    await Promise.all([connected(bobSocket), connected(carolSocket)]);
    expect(
      await emitWithAck(bobSocket, 'project:join', { workspaceId: alice.workspaceId, projectId }),
    ).toEqual({ ok: true });
    const base = `/api/v1/workspaces/${alice.workspaceId}/projects/${projectId}`;
    return { alice, projectId, bobSocket, carolSocket, base };
  }

  it('PATCH project ⇒ thành viên trong phòng nhận project:updated đúng hợp đồng (ProjectDto, originClientId); ws khác không nhận', async () => {
    const { alice, projectId, bobSocket, carolSocket, base } = await setupRoom();
    const received = nextEvent<unknown>(bobSocket, 'project:updated');
    const leaked = noEvent(carolSocket, 'project:updated', 300);
    const tab = '3b241101-e2bb-4255-8caf-4136c566a962';
    const res = await request(t.app)
      .patch(base)
      .set(alice.auth)
      .set('X-Client-Id', tab)
      .send({ name: 'Website mới' });
    expect(res.status).toBe(200);

    const event = ProjectUpdatedEvent.parse(await received);
    expect(event).toMatchObject({
      type: 'project:updated',
      actorId: alice.id,
      originClientId: tab,
      data: { project: { id: projectId, name: 'Website mới', isArchived: false } },
    });
    expect(await leaked).toBe(true);
  });

  it('archive ⇒ isArchived true (FE khóa board); archive lần 2 (không đổi) ⇒ KHÔNG phát lại', async () => {
    const { alice, projectId, bobSocket, base } = await setupRoom();
    const received = nextEvent<unknown>(bobSocket, 'project:updated');
    expect((await request(t.app).post(`${base}/archive`).set(alice.auth).send({})).status).toBe(
      200,
    );
    const event = ProjectUpdatedEvent.parse(await received);
    expect(event.data.project).toMatchObject({ id: projectId, isArchived: true });
    expect(event.data.project.archivedAt).not.toBeNull();

    const again = noEvent(bobSocket, 'project:updated', 300);
    expect((await request(t.app).post(`${base}/archive`).set(alice.auth).send({})).status).toBe(
      200,
    );
    expect(await again).toBe(true);
  });

  it('lỗi (PATCH project đã archive ⇒ 422) ⇒ không phát', async () => {
    const { alice, bobSocket, base } = await setupRoom();
    await request(t.app).post(`${base}/archive`).set(alice.auth).send({});
    await new Promise((r) => setTimeout(r, 100)); // bỏ qua event của archive
    const none = noEvent(bobSocket, 'project:updated', 300);
    const res = await request(t.app).patch(base).set(alice.auth).send({ name: 'Không được' });
    expect(res.status).toBe(422);
    expect(await none).toBe(true);
  });
});
