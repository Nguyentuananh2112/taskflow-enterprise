import type { IncomingMessage } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  connectError,
  connected,
  disconnected,
  emitWithAck,
  nextEvent,
  noEvent,
  startRealtime,
} from '../../../test/support/realtime';
import { ServiceUnavailableError, TokenExpiredError, UnauthorizedError } from '../errors';
import type { RealtimeEnvelope } from './events';
import { clientIp } from './gateway';

const WS = '0199e5a2-7c1e-7cc3-9a3b-000000000001';
const P1 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a1';
const P2 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a2';
const CLIENT = '3b241101-e2bb-4255-8caf-4136c566a962';

let rt: Awaited<ReturnType<typeof startRealtime>>;
afterEach(async () => rt?.close());

describe('SEC-56 — Origin & transport (chống CSWSH)', () => {
  it('Origin trong whitelist + websocket + token hợp lệ ⇒ kết nối', async () => {
    rt = await startRealtime();
    await connected(rt.client());
  });

  it.each([
    ['Origin lạ', { origin: 'https://evil.example' }],
    ['thiếu Origin', { origin: null }],
    ['transport polling', { transport: 'polling' as const }],
  ])('%s (token hợp lệ) ⇒ bị từ chối', async (_label, opts) => {
    rt = await startRealtime();
    const err = await connectError(rt.client(opts));
    expect(err.message).not.toBe('');
    expect(rt.authenticator.calls).toEqual([]); // bị chặn TRƯỚC khi xác thực
  });
});

describe('handshake xác thực (SEC-35)', () => {
  it.each([
    ['không có token', '', 'UNAUTHORIZED'],
    ['token hết hạn', 'expired', 'TOKEN_EXPIRED'],
    ['token sai / tv cũ', 'bad', 'UNAUTHORIZED'],
    ['DB+Valkey lỗi', 'down', 'SERVICE_UNAVAILABLE'],
    ['lỗi không lường trước', 'boom', 'UNAUTHORIZED'],
  ])('%s ⇒ connect_error data.code=%s', async (_label, token, code) => {
    rt = await startRealtime();
    rt.authenticator.errors.set('expired', new TokenExpiredError());
    rt.authenticator.errors.set('bad', new UnauthorizedError());
    rt.authenticator.errors.set('down', new ServiceUnavailableError());
    rt.authenticator.errors.set('boom', new Error('kaboom'));
    expect(await connectError(rt.client({ token }))).toEqual({ message: code, code });
  });

  it('thành công: tự vào phòng user + session; clientId không hợp lệ ⇒ null', async () => {
    rt = await startRealtime();
    const socket = rt.client({ token: 'user:u1:s1', clientId: 'not-a-uuid' });
    await connected(socket);
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])]).toEqual(expect.arrayContaining(['user:u1', 'session:s1']));
    expect(server?.data.clientId).toBeNull();
  });
});

describe('project:join / project:leave', () => {
  it('ack theo contract: VALIDATION_ERROR, RESOURCE_NOT_FOUND (SEC-36), ok', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client();
    await connected(socket);
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS })).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P2 })).toEqual({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: true,
    });
  });

  it('chỉ thành viên phòng nhận event; rời phòng thì thôi nhận', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const member = rt.client({ token: 'user:u1:s1' });
    const outsider = rt.client({ token: 'user:u2:s2' });
    await Promise.all([connected(member), connected(outsider)]);
    await emitWithAck(member, 'project:join', { workspaceId: WS, projectId: P1 });
    expect(
      await emitWithAck(outsider, 'project:join', { workspaceId: WS, projectId: P1 }),
    ).toMatchObject({ ok: false });

    const received = nextEvent<RealtimeEnvelope>(member, 'task:created');
    const leaked = noEvent(outsider, 'task:created');
    await rt.gateway.emitToProject(
      { projectId: P1, type: 'task:created', data: { task: { id: 't1' } } },
      { actorId: 'u9', originClientId: CLIENT },
    );
    expect(await received).toEqual({
      eventId: '00000000-0000-7000-8000-000000000001',
      type: 'task:created',
      occurredAt: rt.clock.now().toISOString(),
      actorId: 'u9',
      originClientId: CLIENT,
      data: { task: { id: 't1' } },
    });
    expect(await leaked).toBe(true);

    expect(await emitWithAck(member, 'project:leave', { projectId: P1 })).toEqual({ ok: true });
    const afterLeave = noEvent(member, 'task:created');
    await rt.gateway.emitToProject(
      { projectId: P1, type: 'task:created', data: {} },
      { actorId: 'u9' },
    );
    expect(await afterLeave).toBe(true);
    expect(await emitWithAck(member, 'project:leave', { projectId: 'x' })).toEqual({
      ok: false,
      code: 'VALIDATION_ERROR',
    });
  });

  it('checker lỗi ⇒ SERVICE_UNAVAILABLE (log), không join', async () => {
    rt = await startRealtime();
    rt.accessChecker.failWith = new Error('db down');
    const socket = rt.client();
    await connected(socket);
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(rt.logger.messages('error')).toContain('realtime.project_join_check_failed');
  });

  it('tối đa 20 phòng/socket; join lại phòng đang ở vẫn ok', async () => {
    rt = await startRealtime();
    const ids = Array.from(
      { length: 21 },
      (_, i) => `0199e5a2-7c1e-7cc3-9a3b-${String(i).padStart(12, '0')}`,
    );
    ids.forEach((id) => rt.accessChecker.allow('u1', WS, id));
    const socket = rt.client();
    await connected(socket);
    for (const id of ids.slice(0, 20))
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: id });
    expect(
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: ids[20] }),
    ).toEqual({ ok: false, code: 'BUSINESS_RULE_VIOLATION' });
    expect(
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: ids[0] }),
    ).toEqual({ ok: true });
  });

  it('30 lần join/phút/socket ⇒ RATE_LIMITED; qua cửa sổ thì được lại', async () => {
    rt = await startRealtime();
    const socket = rt.client();
    await connected(socket);
    for (let i = 0; i < 30; i++)
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
    });
    rt.clock.advance(60_001);
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('event không có ack bị bỏ qua (không crash)', async () => {
    rt = await startRealtime();
    const socket = rt.client();
    await connected(socket);
    socket.emit('project:join', { workspaceId: WS, projectId: P1 });
    socket.emit('project:leave', { projectId: P1 });
    socket.emit('auth:renew', { token: 'user:u1:s1' });
    expect(await emitWithAck(socket, 'project:leave', { projectId: P1 })).toEqual({ ok: true });
  });
});

describe('thu hồi quyền phía server (security §5.4) — gọi sau commit', () => {
  it('disconnectSession chỉ ngắt đúng phiên; disconnectUser ngắt mọi phiên của user', async () => {
    rt = await startRealtime();
    const s1 = rt.client({ token: 'user:u1:s1' });
    const s2 = rt.client({ token: 'user:u1:s2' });
    const other = rt.client({ token: 'user:u2:s3' });
    await Promise.all([connected(s1), connected(s2), connected(other)]);

    const gone1 = disconnected(s1);
    await rt.gateway.disconnectSession('s1');
    expect(await gone1).toBe('io server disconnect');
    expect(s2.connected).toBe(true);

    const gone2 = disconnected(s2);
    await rt.gateway.disconnectUser('u1');
    expect(await gone2).toBe('io server disconnect');
    expect(other.connected).toBe(true);
  });

  it('revokeWorkspaceAccess (SEC-37): rời phòng project + nhận workspace:access-revoked', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client();
    await connected(socket);
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });

    const revoked = nextEvent<RealtimeEnvelope>(socket, 'workspace:access-revoked');
    await rt.gateway.revokeWorkspaceAccess(
      { userId: 'u1', workspaceId: WS, projectIds: [P1, P2] },
      { actorId: 'owner' },
    );
    expect(await revoked).toMatchObject({
      type: 'workspace:access-revoked',
      actorId: 'owner',
      originClientId: null,
      data: { workspaceId: WS },
    });

    const after = noEvent(socket, 'task:updated');
    await rt.gateway.emitToProject(
      { projectId: P1, type: 'task:updated', data: {} },
      { actorId: 'owner' },
    );
    expect(await after).toBe(true);
  });

  it('notifyRoleChanged ⇒ member:role-changed tới phòng user', async () => {
    rt = await startRealtime();
    const socket = rt.client();
    await connected(socket);
    const changed = nextEvent<RealtimeEnvelope>(socket, 'member:role-changed');
    await rt.gateway.notifyRoleChanged(
      { userId: 'u1', workspaceId: WS, role: 'VIEWER' },
      { actorId: 'pm' },
    );
    expect((await changed).data).toEqual({ workspaceId: WS, role: 'VIEWER' });
  });

  it('closeWorkspace: mọi thành viên nhận access-revoked (kể cả không ở phòng project), rồi rời phòng', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const inRoom = rt.client({ token: 'user:u1:s1' });
    const browsing = rt.client({ token: 'user:u2:s2' });
    await Promise.all([connected(inRoom), connected(browsing)]);
    await emitWithAck(inRoom, 'project:join', { workspaceId: WS, projectId: P1 });

    const a = nextEvent(inRoom, 'workspace:access-revoked');
    const b = nextEvent(browsing, 'workspace:access-revoked');
    await rt.gateway.closeWorkspace(
      { workspaceId: WS, projectIds: [P1], memberUserIds: ['u1', 'u2', 'offline-user'] },
      { actorId: 'owner' },
    );
    await Promise.all([a, b]);
    const after = noEvent(inRoom, 'task:deleted');
    await rt.gateway.emitToProject(
      { projectId: P1, type: 'task:deleted', data: {} },
      { actorId: 'owner' },
    );
    expect(await after).toBe(true);
    await rt.gateway.closeWorkspace(
      { workspaceId: WS, projectIds: [], memberUserIds: [] },
      { actorId: 'owner' },
    );
  });
});

describe('auth:renew & hết hạn (security §5.3)', () => {
  it('SEC-38: không renew trước exp ⇒ auth:expired rồi bị ngắt', async () => {
    rt = await startRealtime();
    rt.authenticator.ttlMs = 150;
    const socket = rt.client();
    await connected(socket);
    const expired = nextEvent<RealtimeEnvelope>(socket, 'auth:expired', 2_000);
    const gone = disconnected(socket);
    expect((await expired).data).toEqual({});
    expect(await gone).toBe('io server disconnect');
  });

  it('renew hợp lệ ⇒ ok, gia hạn timer, đổi phòng session khi sid đổi, rời phòng đã mất quyền', async () => {
    rt = await startRealtime();
    rt.authenticator.ttlMs = 200;
    rt.accessChecker.allow('u1', WS, P1).allow('u1', WS, P2);
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P2 });
    rt.accessChecker.revoke('u1', WS, P2);

    rt.authenticator.ttlMs = 60_000;
    expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s9' })).toEqual({ ok: true });
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])].sort()).toEqual(
      ['project:' + P1, 'session:s9', 'user:u1', server?.id ?? ''].sort(),
    );
    expect(await noEvent(socket, 'auth:expired', 350)).toBe(true); // timer cũ (200ms) đã bị thay
  });

  it('renew: lỗi checker khi kiểm lại ⇒ giữ phòng (log warn)', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client();
    await connected(socket);
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });
    rt.accessChecker.failWith = new Error('db');
    expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s1' })).toEqual({ ok: true });
    expect(rt.logger.messages('warn')).toContain('realtime.recheck_failed_keep_room');
  });

  it.each([
    ['SEC-39: token của user khác', { token: 'user:u2:s1' }],
    ['token sai', { token: 'bad' }],
    ['payload sai', {}],
    ['lỗi lạ', { token: 'boom' }],
  ])('%s ⇒ ack UNAUTHORIZED rồi bị ngắt', async (_label, payload) => {
    rt = await startRealtime();
    rt.authenticator.errors.set('bad', new UnauthorizedError());
    rt.authenticator.errors.set('boom', new Error('kaboom'));
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    const gone = disconnected(socket);
    expect(await emitWithAck(socket, 'auth:renew', payload)).toEqual({
      ok: false,
      code: 'UNAUTHORIZED',
    });
    expect(await gone).toBe('io server disconnect');
  });
});

describe('handshake rate limit, đóng gateway, IP client', () => {
  it('limiter từ chối ⇒ connect_error; limiter lỗi ⇒ từ chối', async () => {
    let allowed = false;
    rt = await startRealtime({
      handshakeLimiter: {
        hit: () =>
          allowed
            ? Promise.reject(new Error('x'))
            : Promise.resolve({ allowed: false, retryAfterSec: 30 }),
      },
    });
    expect((await connectError(rt.client())).message).not.toBe('');
    allowed = true;
    expect((await connectError(rt.client())).message).not.toBe('');
  });

  it('limiter cho qua ⇒ kết nối, key là IP', async () => {
    const keys: string[] = [];
    rt = await startRealtime({
      handshakeLimiter: {
        hit: (key) =>
          Promise.resolve(void keys.push(key)).then(() => ({ allowed: true, retryAfterSec: 0 })),
      },
    });
    await connected(rt.client());
    expect(keys).toEqual(['127.0.0.1']);
  });

  it('close() ngắt mọi socket của instance', async () => {
    rt = await startRealtime();
    const socket = rt.client();
    await connected(socket);
    const gone = disconnected(socket);
    await rt.gateway.close();
    expect(await gone).toBe('io server disconnect');
  });

  it('clientIp tôn trọng TRUST_PROXY_HOPS', () => {
    const req = (xff: string | undefined) =>
      ({
        headers: xff ? { 'x-forwarded-for': xff } : {},
        socket: { remoteAddress: '10.0.0.9' },
      }) as unknown as IncomingMessage;
    expect(clientIp(req('1.1.1.1, 2.2.2.2'), 0)).toBe('10.0.0.9');
    expect(clientIp(req('1.1.1.1, 2.2.2.2'), 1)).toBe('2.2.2.2');
    expect(clientIp(req('1.1.1.1, 2.2.2.2'), 2)).toBe('1.1.1.1');
    expect(clientIp(req('1.1.1.1'), 5)).toBe('1.1.1.1');
    expect(clientIp(req(undefined), 1)).toBe('10.0.0.9');
  });
});
