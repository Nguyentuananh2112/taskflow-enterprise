import type { IncomingMessage } from 'node:http';

import { MemoryStore } from 'express-rate-limit';
import { Server, type Namespace, type ServerOptions } from 'socket.io';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectError,
  connected,
  disconnected,
  emitWithAck,
  nextEvent,
  noEvent,
  startRealtime,
} from '../../../test/support/realtime';
import { SpyLogger } from '../../../test/support';
import { ServiceUnavailableError, TokenExpiredError, UnauthorizedError } from '../errors';
import { createHitLimiter } from '../http/rate-limit/rate-limit';
import { RATE_LIMIT_RULES } from '../http/rate-limit/rules';
import type { RealtimeEnvelope } from './events';
import { clientIp } from './gateway';

const WS = '0199e5a2-7c1e-7cc3-9a3b-000000000001';
const P1 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a1';
const P2 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a2';
const WS2 = '0199e5a2-7c1e-7cc3-9a3b-000000000002';
const P3 = '0199e5a2-7c1e-7cc3-9a3b-0000000000a3';
const CLIENT = '3b241101-e2bb-4255-8caf-4136c566a962';

let rt: Awaited<ReturnType<typeof startRealtime>>;
afterEach(async () => rt?.close());

type LocalFlagOpts = { flags?: { local?: boolean } };

/**
 * Mô phỏng `@socket.io/redis-adapter` khi publish lên Valkey lỗi (T-028 H3): thao tác CỤM
 * (`socketsLeave`/`disconnectSockets` không cờ `local`) chỉ publish rồi chờ message quay về ⇒ bị
 * mất hẳn, kể cả ở instance hiện tại. Thao tác có cờ `local` vẫn chạy.
 */
function lossyClusterAdapter(): ServerOptions['adapter'] {
  // Server không gắn http server: chỉ để lấy lớp Adapter mặc định, không giữ tài nguyên nào.
  const probe = new Server();
  type BaseAdapter = Namespace['adapter'];
  const Base = probe.of('/').adapter.constructor as new (nsp: Namespace) => BaseAdapter;
  return class LossyClusterAdapter extends Base {
    override delSockets(...args: Parameters<BaseAdapter['delSockets']>): void {
      if ((args[0] as LocalFlagOpts).flags?.local) super.delSockets(...args);
    }

    override disconnectSockets(...args: Parameters<BaseAdapter['disconnectSockets']>): void {
      if ((args[0] as LocalFlagOpts).flags?.local) super.disconnectSockets(...args);
    }
  } as unknown as ServerOptions['adapter'];
}

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
    expect([...(server?.rooms ?? [])]).toEqual(
      expect.arrayContaining(['user:u1', 'session:s1', 'company']),
    );
    expect(server?.data.clientId).toBeNull();
  });

  it('review B M1: phiên bị thu hồi TRONG LÚC handshake (disconnectUser hụt) ⇒ xác thực lại sau khi vào phòng thất bại ⇒ ngắt, project:join không được kiểm/vào phòng', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    rt.authenticator.before = async (token, call) => {
      // logout-all commit khi handshake còn trong authenticate(): socket chưa ở phòng user ⇒ hụt.
      if (call === 1) await rt.gateway.disconnectUser('u1');
      if (call === 2) {
        rt.authenticator.errors.set(token, new UnauthorizedError());
        await held; // giữ lần xác thực lại ⇒ project:join phải chờ nó
      }
    };
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    const gone = disconnected(socket);
    socket.emit('project:join', { workspaceId: WS, projectId: P1 }, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rt.accessChecker.checks).toBe(0);
    release();
    expect(await gone).toBe('io server disconnect');
    expect(rt.accessChecker.checks).toBe(0);
    expect(await rt.gateway.io.fetchSockets()).toHaveLength(0);
  });

  it('review B M1: xác thực lại lỗi lạ ⇒ fail-closed (ngắt, log)', async () => {
    rt = await startRealtime();
    rt.authenticator.before = (token, call) => {
      if (call === 2) rt.authenticator.errors.set(token, new Error('kaboom'));
    };
    const socket = rt.client({ token: 'user:u1:s1' });
    const gone = disconnected(socket);
    await connected(socket);
    expect(await gone).toBe('io server disconnect');
    expect(rt.logger.messages('error')).toContain('realtime.handshake_recheck_failed');
  });

  it('review B M2: tối đa 20 socket/user/instance ⇒ socket thứ 21 bị từ chối RATE_LIMITED; user khác không ảnh hưởng; đóng socket trả suất', async () => {
    rt = await startRealtime();
    const mine = Array.from({ length: 20 }, () => rt.client({ token: 'user:u1:s1' }));
    await Promise.all(mine.map(connected));
    expect(await connectError(rt.client({ token: 'user:u1:s2' }))).toEqual({
      message: 'RATE_LIMITED',
      code: 'RATE_LIMITED',
    });
    expect(rt.logger.messages('warn')).toContain('realtime.socket_cap_reached');
    await connected(rt.client({ token: 'user:u2:s9' }));
    mine[0]?.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await connected(rt.client({ token: 'user:u1:s3' }));
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

  it('TOCTOU (review T-016): thu hồi commit giữa lần kiểm và join ⇒ không ở lại phòng, ack RESOURCE_NOT_FOUND', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client();
    await connected(socket);
    rt.accessChecker.interleave = async (check) => {
      if (check !== 1) return;
      // Lần kiểm 1 đã quyết định "được"; trước khi socket.join chạy, use case xóa thành viên commit
      // (DB không còn quyền) và afterCommit gọi gateway — lúc này socket CHƯA ở phòng nên socketsLeave hụt.
      rt.accessChecker.revoke('u1', WS, P1);
      await rt.gateway.revokeWorkspaceAccess(
        { userId: 'u1', workspaceId: WS, projectIds: [P1] },
        { actorId: 'owner' },
      );
    };

    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])]).not.toContain(`project:${P1}`);
    const leaked = noEvent(socket, 'task:updated');
    await rt.gateway.emitToProject(
      { projectId: P1, type: 'task:updated', data: {} },
      { actorId: 'owner' },
    );
    expect(await leaked).toBe(true);
  });

  it('TOCTOU: kiểm lại sau join lỗi ⇒ fail-closed (rời phòng, log)', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    rt.accessChecker.interleave = (check) => (check === 2 ? 'throw' : undefined);
    const socket = rt.client();
    await connected(socket);
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])]).not.toContain(`project:${P1}`);
    expect(rt.logger.messages('error')).toContain('realtime.project_join_recheck_failed');
  });

  it('giới hạn 20 phòng đếm theo phòng thực tế (phòng bị thu hồi phía server trả lại suất)', async () => {
    rt = await startRealtime();
    const ids = Array.from(
      { length: 21 },
      (_, i) => `0199e5a2-7c1e-7cc3-9a3b-${String(i).padStart(12, '0')}`,
    );
    ids.forEach((id) => rt.accessChecker.allow('u1', WS, id));
    const socket = rt.client();
    await connected(socket);
    for (const id of ids.slice(0, 20)) {
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: id });
    }
    await rt.gateway.revokeWorkspaceAccess(
      { userId: 'u1', workspaceId: WS, projectIds: [ids[0] ?? ''] },
      { actorId: 'owner' },
    );
    expect(
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: ids[20] }),
    ).toEqual({ ok: true });
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

  it('review B M2: 60 lần join/phút/user gộp mọi socket của user trên instance', async () => {
    rt = await startRealtime();
    const sockets = Array.from({ length: 3 }, () => rt.client({ token: 'user:u1:s1' }));
    const other = rt.client({ token: 'user:u2:s2' });
    await Promise.all([...sockets, other].map(connected));
    const acks = [];
    for (const socket of sockets) {
      for (let i = 0; i < 21; i++)
        acks.push(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 }));
    }
    expect(acks.filter((a) => !a.ok && a.code === 'RATE_LIMITED')).toHaveLength(3);
    expect(acks.slice(60)).toEqual(Array(3).fill({ ok: false, code: 'RATE_LIMITED' }));
    expect(await emitWithAck(other, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('review B L1: join song song không vượt 20 phòng/socket (giữ suất trước khi await)', async () => {
    rt = await startRealtime();
    const ids = Array.from(
      { length: 25 },
      (_, i) => `0199e5a2-7c1e-7cc3-9a3b-${String(i).padStart(12, '0')}`,
    );
    ids.forEach((id) => rt.accessChecker.allow('u1', WS, id));
    // Mỗi lần kiểm nhường event loop ⇒ các join chồng lên nhau giữa lúc đếm và lúc vào phòng.
    rt.accessChecker.interleave = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
    const socket = rt.client();
    await connected(socket);
    const acks = await Promise.all(
      ids.map((id) => emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: id })),
    );
    expect(acks.filter((a) => a.ok)).toHaveLength(20);
    expect(acks.filter((a) => !a.ok)).toEqual(
      Array(5).fill({ ok: false, code: 'BUSINESS_RULE_VIOLATION' }),
    );
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])].filter((r) => r.startsWith('project:'))).toHaveLength(20);
  });

  it('review B L1 (vòng 2): hai join CÙNG phòng song song, join đầu thất bại ⇒ suất của join sau vẫn được giữ', async () => {
    rt = await startRealtime();
    const ids = Array.from(
      { length: 21 },
      (_, i) => `0199e5a2-7c1e-7cc3-9a3b-${String(i).padStart(12, '0')}`,
    );
    ids.forEach((id) => rt.accessChecker.allow('u1', WS, id));
    const socket = rt.client();
    await connected(socket);
    for (const id of ids.slice(0, 19))
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: id });
    const base = rt.accessChecker.checks;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    // Join A lần 1: kiểm lỗi ngay. Join A lần 2: kiểm bị giữ ⇒ vẫn đang giữ suất phòng A.
    rt.accessChecker.interleave = (check) =>
      check === base + 1 ? 'throw' : check === base + 2 ? held : undefined;
    const a = { workspaceId: WS, projectId: ids[19] };
    const first = emitWithAck(socket, 'project:join', a);
    const second = emitWithAck(socket, 'project:join', a);
    expect(await first).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(
      await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: ids[20] }),
    ).toEqual({ ok: false, code: 'BUSINESS_RULE_VIOLATION' });
    release();
    expect(await second).toEqual({ ok: true });
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])].filter((r) => r.startsWith('project:'))).toHaveLength(20);
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

  it('T-028 H3: thao tác cụm bị mất (Valkey lỗi) ⇒ instance hiện tại VẪN ngắt / đẩy socket khỏi phòng', async () => {
    rt = await startRealtime({ adapter: lossyClusterAdapter() });
    rt.accessChecker.allow('u1', WS, P1).allow('u2', WS, P1);
    const s1 = rt.client({ token: 'user:u1:s1' });
    const s2 = rt.client({ token: 'user:u1:s2' });
    const member = rt.client({ token: 'user:u2:s3' });
    await Promise.all([connected(s1), connected(s2), connected(member)]);
    await emitWithAck(member, 'project:join', { workspaceId: WS, projectId: P1 });

    await rt.gateway.revokeWorkspaceAccess(
      { userId: 'u2', workspaceId: WS, projectIds: [P1] },
      { actorId: 'owner' },
    );
    const [server] = (await rt.gateway.io.fetchSockets()).filter((s) => s.data.userId === 'u2');
    expect(server?.rooms.has('project:' + P1)).toBe(false);

    const gone1 = disconnected(s1);
    await rt.gateway.disconnectSession('s1');
    expect(await gone1).toBe('io server disconnect');
    const gone2 = disconnected(s2);
    await rt.gateway.disconnectUser('u1');
    expect(await gone2).toBe('io server disconnect');
    expect(member.connected).toBe(true);

    await emitWithAck(member, 'project:join', { workspaceId: WS, projectId: P2 });
    rt.accessChecker.allow('u2', WS, P2);
    await emitWithAck(member, 'project:join', { workspaceId: WS, projectId: P2 });
    await rt.gateway.closeWorkspace(
      { workspaceId: WS, projectIds: [P2], memberUserIds: ['u2'] },
      { actorId: 'owner' },
    );
    const [after] = await rt.gateway.io.fetchSockets();
    expect(after?.rooms.has('project:' + P2)).toBe(false);
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

  it('review B G1: revokeWorkspaceAccess rời CẢ phòng project không có trong projectIds (ảnh chụp tx thiếu project mới) — chỉ của workspace đó', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1).allow('u1', WS2, P3);
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });
    await emitWithAck(socket, 'project:join', { workspaceId: WS2, projectId: P3 });
    // P1 được tạo SAU khi use case đọc listIds ⇒ projectIds rỗng.
    await rt.gateway.revokeWorkspaceAccess(
      { userId: 'u1', workspaceId: WS, projectIds: [] },
      { actorId: 'owner' },
    );
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])]).not.toContain(`project:${P1}`);
    expect([...(server?.rooms ?? [])]).toContain(`project:${P3}`);
    const leaked = noEvent(socket, 'task:updated');
    await rt.gateway.emitToProject(
      { projectId: P1, type: 'task:updated', data: {} },
      { actorId: 'owner' },
    );
    expect(await leaked).toBe(true);
  });

  it('review B G1 vòng 2: lần kiểm lại đọc "còn quyền" nhưng trả về SAU hook thu hồi (projectIds thiếu P) ⇒ không ở lại phòng', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    rt.accessChecker.interleave = async (check) => {
      if (check !== 2) return;
      // Kiểm lại đã đọc "còn là thành viên"; thu hồi commit và hook chạy trước khi kết quả về.
      await rt.gateway.revokeWorkspaceAccess(
        { userId: 'u1', workspaceId: WS, projectIds: [] },
        { actorId: 'owner' },
      );
    };
    expect(await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 })).toEqual({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])]).not.toContain(`project:${P1}`);
    expect(server?.data.joined.size).toBe(0);
  });

  it('review B G1: closeWorkspace rời phòng theo `joined` của MỌI socket (projectIds thiếu project)', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1).allow('u2', WS, P1).allow('u2', WS2, P3);
    const a = rt.client({ token: 'user:u1:s1' });
    const b = rt.client({ token: 'user:u2:s2' });
    await Promise.all([connected(a), connected(b)]);
    await emitWithAck(a, 'project:join', { workspaceId: WS, projectId: P1 });
    await emitWithAck(b, 'project:join', { workspaceId: WS, projectId: P1 });
    await emitWithAck(b, 'project:join', { workspaceId: WS2, projectId: P3 });
    await rt.gateway.closeWorkspace(
      { workspaceId: WS, projectIds: [], memberUserIds: ['u1', 'u2'] },
      { actorId: 'owner' },
    );
    const roomsOf = (await rt.gateway.io.fetchSockets()).flatMap((s) => [...s.rooms]);
    expect(roomsOf).not.toContain(`project:${P1}`);
    expect(roomsOf).toContain(`project:${P3}`);
  });

  it('review B G1: có adapter cụm ⇒ báo instance khác qua serverSideEmit; nhận message từ instance khác ⇒ rời phòng theo joined', async () => {
    rt = await startRealtime({ adapter: lossyClusterAdapter() });
    const broadcast = vi.spyOn(rt.gateway.io, 'serverSideEmit').mockImplementation(() => true);
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    await rt.gateway.revokeWorkspaceAccess(
      { userId: 'u1', workspaceId: WS, projectIds: [] },
      { actorId: 'owner' },
    );
    expect(broadcast).toHaveBeenCalledWith('workspace:leave-rooms', {
      workspaceId: WS,
      userId: 'u1',
    });

    // Instance khác thu hồi: message tới instance này.
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });
    const nsp = rt.gateway.io.of('/') as unknown as { _onServerSideEmit(args: unknown[]): void };
    nsp._onServerSideEmit(['workspace:leave-rooms', { workspaceId: WS, userId: 'u1' }]);
    const [server] = await rt.gateway.io.fetchSockets();
    expect([...(server?.rooms ?? [])]).not.toContain(`project:${P1}`);
    expect(server?.data.joined.size).toBe(0);
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
      // `company` (Mốc 6 — T-068): mọi socket đã xác thực lại, cho `user:avatar-changed`.
      ['company', 'project:' + P1, 'session:s9', 'user:u1', server?.id ?? ''].sort(),
    );
    expect(await noEvent(socket, 'auth:expired', 350)).toBe(true); // timer cũ (200ms) đã bị thay
  });

  it('review B L3: renew mà kiểm lại phòng lỗi ⇒ fail-closed: ack SERVICE_UNAVAILABLE rồi ngắt (client nối + join lại)', async () => {
    rt = await startRealtime();
    rt.accessChecker.allow('u1', WS, P1);
    const socket = rt.client();
    await connected(socket);
    await emitWithAck(socket, 'project:join', { workspaceId: WS, projectId: P1 });
    rt.accessChecker.failWith = new Error('db');
    const gone = disconnected(socket);
    expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s1' })).toEqual({
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(await gone).toBe('io server disconnect');
    expect(rt.logger.messages('warn')).toContain('realtime.recheck_failed_disconnect');
  });

  it('review B L2: renew đổi sid mà phiên mới bị thu hồi trước khi vào phòng session mới ⇒ UNAUTHORIZED + ngắt', async () => {
    rt = await startRealtime();
    const socket = rt.client({ token: 'user:u1:s1' });
    await connected(socket);
    const renewCalls: number[] = [];
    rt.authenticator.before = async (token, call) => {
      if (token !== 'user:u1:s2') return;
      renewCalls.push(call);
      // logout(s2) commit trong lúc renew xác thực: socket chưa ở phòng session:s2 ⇒
      // disconnectSession(s2) hụt; lần xác thực lại (sau khi đổi phòng) thấy phiên đã thu hồi.
      if (renewCalls.length === 1) await rt.gateway.disconnectSession('s2');
      if (renewCalls.length === 2) rt.authenticator.errors.set(token, new UnauthorizedError());
    };
    const gone = disconnected(socket);
    expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s2' })).toEqual({
      ok: false,
      code: 'UNAUTHORIZED',
    });
    expect(await gone).toBe('io server disconnect');
    expect(renewCalls).toHaveLength(2);
  });

  it('T-028: auth:renew tối đa 5 lần/phút/socket ⇒ RATE_LIMITED (không gọi authenticator, không ngắt); qua cửa sổ thì được lại', async () => {
    rt = await startRealtime();
    const socket = rt.client();
    await connected(socket);
    const before = rt.authenticator.calls.length;
    for (let i = 0; i < 5; i++)
      expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s1' })).toEqual({
        ok: true,
      });
    expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s1' })).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
    });
    expect(rt.authenticator.calls.length - before).toBe(5);
    expect(socket.connected).toBe(true);
    rt.clock.advance(60_001);
    expect(await emitWithAck(socket, 'auth:renew', { token: 'user:u1:s1' })).toEqual({ ok: true });
  });

  it('T-028: auth:renew tối đa 30 lần/phút/user gộp mọi socket của user trên instance', async () => {
    rt = await startRealtime();
    const sockets = Array.from({ length: 7 }, (_, i) => rt.client({ token: `user:u1:s${i}` }));
    const other = rt.client({ token: 'user:u2:s9' });
    await Promise.all([...sockets, other].map(connected));
    const acks = [];
    for (const [i, socket] of sockets.entries()) {
      for (let k = 0; k < 5; k++)
        acks.push(await emitWithAck(socket, 'auth:renew', { token: `user:u1:s${i}` }));
    }
    expect(acks.filter((a) => a.ok)).toHaveLength(30);
    expect(acks.slice(30)).toEqual(Array(5).fill({ ok: false, code: 'RATE_LIMITED' }));
    expect(await emitWithAck(other, 'auth:renew', { token: 'user:u2:s9' })).toEqual({ ok: true });
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

  it('rule thật socket-handshake-ip: 50 handshake từ 1 IP trong 1 phút đều qua; vượt ngưỡng ⇒ từ chối (lỗi #2)', async () => {
    const rule = RATE_LIMIT_RULES.socketHandshake[0];
    const limiter = createHitLimiter(rule, {
      storeFor: () => new MemoryStore(),
      logger: new SpyLogger(),
    });
    const verdicts: boolean[] = [];
    rt = await startRealtime({
      handshakeLimiter: {
        hit: (key) => limiter.hit(key).then((r) => (verdicts.push(r.allowed), r)),
      },
    });
    // Cả văn phòng chung một IP NAT (127.0.0.1 ở đây), mỗi người một tài khoản.
    for (let i = 0; i < 50; i++) {
      const socket = rt.client({ token: `user:office${i}:s${i}` });
      await connected(socket);
      socket.close();
    }
    for (let i = 50; i < rule.limit; i++) await limiter.hit('127.0.0.1');
    expect((await connectError(rt.client({ token: 'user:late:s1' }))).message).not.toBe('');
    // Bị từ chối đúng vì HẠN MỨC (token hợp lệ): 50 lượt đầu cho qua, lượt cuối limiter trả allowed=false.
    expect(verdicts).toEqual([...Array<boolean>(50).fill(true), false]);
    expect((await limiter.hit('10.0.0.2')).allowed).toBe(true);
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
