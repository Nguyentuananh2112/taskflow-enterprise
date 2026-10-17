import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { BoardEvent } from './mock-board';
import { createMockApi } from './index';

// Mock quản trị workspace/thành viên/project phải khắt khe như server (T-034, data-and-api §2.5–2.6,
// security.md §3.2/§6.5, ADR-044/046/047/050/094) — bài học H2: mock dễ dãi ⇒ lỗi lọt prod.

const BASE = 'http://localhost:4000/api/v1';
const ORIGIN = 'http://localhost:4000';
const TAB = '0199e5a2-0000-7000-8000-00000000c1e1';

type Json = {
  data: Record<string, unknown> & { id: string };
  error: { code: string; details: Record<string, unknown> };
};

function setup() {
  let now = Date.parse('2026-10-15T08:00:00.000Z');
  const api = createMockApi(BASE, { now: () => now });
  const events: BoardEvent[] = [];
  api.board.onEvent((e) => events.push(e));
  const send = async (
    token: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = { 'content-type': 'application/json' },
  ) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${token}`,
          'x-client-id': TAB,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return { status: response.status, body: (await response.json()) as Json };
  };
  const user = (fullName: string, email: string) => {
    const created = api.db.createUser({ email, password: 'x', fullName });
    return { ...created, token: api.db.issueAccess(created.user).accessToken };
  };
  const owner = user('Trần Lan', 'lan@example.com');
  const wsId = owner.defaultWorkspaceId;
  const join = (u: ReturnType<typeof user>, role: WorkspaceRole) =>
    api.db.workspaces.setMember(wsId, u.user.id, role);
  const advance = (ms: number) => {
    now += ms;
  };
  return { api, events, send, user, owner, wsId, join, advance };
}

describe('workspace', () => {
  it('tạo: slug trống ⇒ server sinh từ tên tiếng Việt; slug dành riêng ⇒ 409 field slug', async () => {
    const { send, owner } = setup();
    const created = await send(owner.token, 'POST', '/workspaces', { name: 'Phòng Kỹ thuật' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ slug: 'phong-ky-thuat', myRole: 'OWNER' });
    const reserved = await send(owner.token, 'POST', '/workspaces', { name: 'X', slug: 'admin' });
    expect(reserved.body.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { field: 'slug' },
    });
  });

  it('sửa slug: chữ hoa ⇒ 400 (không tự lowercase); trùng ⇒ 409; MEMBER ⇒ 403', async () => {
    const { send, owner, wsId, user, join } = setup();
    const other = user('Mai Hoa', 'hoa@example.com');
    const otherWs = (await send(other.token, 'GET', '/workspaces')).body.data as unknown as Array<{
      slug: string;
    }>;
    expect(
      (await send(owner.token, 'PATCH', `/workspaces/${wsId}`, { slug: 'Phong-KT' })).status,
    ).toBe(400);
    const dup = await send(owner.token, 'PATCH', `/workspaces/${wsId}`, { slug: otherWs[0]?.slug });
    expect(dup.status).toBe(409);
    join(other, 'MEMBER');
    expect((await send(other.token, 'PATCH', `/workspaces/${wsId}`, { name: 'Mới' })).status).toBe(
      403,
    );
  });

  it('xóa mềm: confirmSlug sai ⇒ 400; đúng ⇒ mọi thành viên 404, event access-revoked; OWNER khôi phục được', async () => {
    const { send, owner, wsId, user, join, events } = setup();
    const member = user('Mai Hoa', 'hoa@example.com');
    join(member, 'MEMBER');
    expect(
      (await send(owner.token, 'DELETE', `/workspaces/${wsId}`, { confirmSlug: 'sai-slug' }))
        .status,
    ).toBe(400);
    const slug = (await send(owner.token, 'GET', `/workspaces/${wsId}`)).body.data.slug;
    const del = await send(owner.token, 'DELETE', `/workspaces/${wsId}`, { confirmSlug: slug });
    expect(del.status).toBe(200);
    expect((await send(member.token, 'GET', `/workspaces/${wsId}`)).status).toBe(404);
    expect(events.filter((e) => e.name === 'workspace:access-revoked').map((e) => e.room)).toEqual([
      `user:${owner.user.id}`,
      `user:${member.user.id}`,
    ]);
    const deleted = await send(owner.token, 'GET', '/workspaces?deleted=true');
    expect((deleted.body.data as unknown as unknown[]).length).toBe(1);
    expect((await send(member.token, 'POST', `/workspaces/${wsId}/restore`)).status).toBe(404);
    expect((await send(owner.token, 'POST', `/workspaces/${wsId}/restore`)).status).toBe(200);
    expect((await send(member.token, 'GET', `/workspaces/${wsId}`)).status).toBe(200);
  });

  it('quá 30 ngày ⇒ không còn trong danh sách đã xóa và khôi phục ⇒ 404 (L1)', async () => {
    const { api, send, owner, wsId, advance } = setup();
    const slug = (await send(owner.token, 'GET', `/workspaces/${wsId}`)).body.data.slug;
    await send(owner.token, 'DELETE', `/workspaces/${wsId}`, { confirmSlug: slug });
    advance(31 * 86_400_000);
    const token = api.db.issueAccess(owner.user).accessToken; // access token cũ đã hết hạn
    const deleted = await send(token, 'GET', '/workspaces?deleted=true');
    expect(deleted.body.data).toEqual([]);
    expect((await send(token, 'POST', `/workspaces/${wsId}/restore`)).status).toBe(404);
  });

  it('DELETE có body nhưng không Content-Type JSON ⇒ body bị bỏ qua ⇒ 400 (L4)', async () => {
    const { send, owner, wsId } = setup();
    const res = await send(owner.token, 'DELETE', `/workspaces/${wsId}`, { confirmSlug: 'x' }, {});
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('charset trùng lặp ⇒ 415 (L5)', async () => {
    const { send, owner } = setup();
    const res = await send(
      owner.token,
      'POST',
      '/workspaces',
      { name: 'A' },
      {
        'content-type': 'application/json; charset=utf-8; charset=utf-8',
      },
    );
    expect(res.status).toBe(415);
  });
});

describe('thành viên', () => {
  it('Mốc 3.5 thêm theo userId: PM cấp PM ⇒ 403 (trước khi tra người); userId lạ ⇒ 404; đã là thành viên ⇒ 409; có lịch nghỉ việc ⇒ 422 NOT_ACTIVE_MEMBER', async () => {
    const { api, send, owner, wsId, user, join } = setup();
    const pm = user('Quản Lý', 'pm@example.com');
    join(pm, 'PM');
    const base = `/workspaces/${wsId}/members`;
    const stranger = crypto.randomUUID();
    expect((await send(pm.token, 'POST', base, { userId: stranger, role: 'PM' })).status).toBe(403);
    expect((await send(pm.token, 'POST', base, { userId: stranger, role: 'MEMBER' })).status).toBe(
      404,
    );
    expect(
      (await send(owner.token, 'POST', base, { userId: pm.user.id, role: 'MEMBER' })).status,
    ).toBe(409);
    const quinn = user('Quinn', 'quinn@example.com');
    api.db.company.setOffboarding(quinn.user.id, '2026-10-31');
    const leaving = await send(owner.token, 'POST', base, {
      userId: quinn.user.id,
      role: 'MEMBER',
    });
    expect(leaving.body.error.details).toEqual({ rule: 'NOT_ACTIVE_MEMBER' });
    expect(
      (await send(owner.token, 'POST', base, { email: 'x@example.com', role: 'MEMBER' })).status,
    ).toBe(400);
  });

  it('member-candidates: nhân viên chưa ở ws, khớp tên/email; MEMBER ⇒ 403; q < 2 ký tự ⇒ 400; người có lịch nghỉ không có', async () => {
    const { api, send, owner, wsId, user, join } = setup();
    const hoa = user('Mai Hoa', 'hoa@example.com');
    const an = user('Mai An', 'an@example.com');
    join(an, 'MEMBER');
    const quinn = user('Mai Quinn', 'quinn@example.com');
    api.db.company.setOffboarding(quinn.user.id, '2026-10-31');
    const path = `/workspaces/${wsId}/member-candidates`;
    const res = await send(owner.token, 'GET', `${path}?q=mai`);
    expect(res.body.data).toEqual([
      { id: hoa.user.id, fullName: 'Mai Hoa', email: 'hoa@example.com' },
    ]);
    expect((await send(an.token, 'GET', `${path}?q=mai`)).status).toBe(403);
    expect((await send(owner.token, 'GET', `${path}?q=m`)).status).toBe(400);
  });

  it('thêm thành viên quá 30 lần/giờ ⇒ 429 có retryAfterSec (L3)', async () => {
    const { send, owner, wsId } = setup();
    for (let i = 0; i < 30; i++) {
      await send(owner.token, 'POST', `/workspaces/${wsId}/members`, {
        userId: crypto.randomUUID(),
        role: 'MEMBER',
      });
    }
    const limited = await send(owner.token, 'POST', `/workspaces/${wsId}/members`, {
      userId: crypto.randomUUID(),
      role: 'MEMBER',
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.details.retryAfterSec).toBeGreaterThan(0);
  });

  it('hạ VIEWER ⇒ bỏ gán task (ADR-044), event task:updated originClientId null (L2), member:role-changed', async () => {
    const { api, send, owner, wsId, user, join, events } = setup();
    const an = user('Nguyễn An', 'an@example.com');
    join(an, 'MEMBER');
    const project = api.board.listProjects(wsId, 'false')[0];
    const tasks = `/workspaces/${wsId}/projects/${project?.id}/tasks`;
    for (const title of ['Việc một', 'Việc hai']) {
      await send(owner.token, 'POST', tasks, { title, assigneeId: an.user.id });
    }
    const res = await send(owner.token, 'PATCH', `/workspaces/${wsId}/members/${an.user.id}`, {
      role: 'VIEWER',
    });
    expect(res.body.data).toMatchObject({ unassignedTaskCount: 2, member: { role: 'VIEWER' } });
    const unassigned = events.filter((e) => e.name === 'task:updated');
    expect(
      unassigned.map((e) => (e.payload as { originClientId: unknown }).originClientId),
    ).toEqual([null, null]);
    expect(events.at(-1)).toMatchObject({
      name: 'member:role-changed',
      room: `user:${an.user.id}`,
    });
  });

  it('OWNER cuối cùng: hạ role / tự rời ⇒ 422 LAST_OWNER; PM xóa OWNER ⇒ 403', async () => {
    const { send, owner, wsId, user, join } = setup();
    const pm = user('Quản Lý', 'pm@example.com');
    join(pm, 'PM');
    const me = `/workspaces/${wsId}/members/${owner.user.id}`;
    expect((await send(owner.token, 'PATCH', me, { role: 'PM' })).body.error.details).toEqual({
      rule: 'LAST_OWNER',
    });
    expect((await send(owner.token, 'DELETE', me)).body.error.details).toEqual({
      rule: 'LAST_OWNER',
    });
    expect((await send(pm.token, 'DELETE', me)).status).toBe(403);
  });

  it('tự rời ⇒ access-revoked tới phòng user; workspace biến mất khỏi danh sách của người đó', async () => {
    const { send, wsId, user, join, events } = setup();
    const an = user('Nguyễn An', 'an@example.com');
    join(an, 'MEMBER');
    const res = await send(an.token, 'DELETE', `/workspaces/${wsId}/members/${an.user.id}`);
    expect(res.body.data).toMatchObject({ userId: an.user.id, unassignedTaskCount: 0 });
    expect(events.at(-1)).toMatchObject({
      name: 'workspace:access-revoked',
      room: `user:${an.user.id}`,
    });
    const mine = (await send(an.token, 'GET', '/workspaces')).body.data as unknown as Array<{
      id: string;
    }>;
    expect(mine.some((w) => w.id === wsId)).toBe(false);
  });
});

describe('project', () => {
  it('tạo: keyPrefix trùng ⇒ 409 field keyPrefix; MEMBER ⇒ 403; sửa project lưu trữ ⇒ 422', async () => {
    const { api, send, owner, wsId, user, join } = setup();
    const base = `/workspaces/${wsId}/projects`;
    const created = await send(owner.token, 'POST', base, { name: 'Website', keyPrefix: 'WEB' });
    expect(created.status).toBe(201);
    const dup = await send(owner.token, 'POST', base, { name: 'Khác', keyPrefix: 'WEB' });
    expect(dup.body.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      details: { field: 'keyPrefix' },
    });
    const member = user('Mai Hoa', 'hoa@example.com');
    join(member, 'MEMBER');
    expect(
      (await send(member.token, 'POST', base, { name: 'Mobile', keyPrefix: 'MOB' })).status,
    ).toBe(403);
    const id = created.body.data.id;
    await send(owner.token, 'POST', `${base}/${id}/archive`);
    expect(
      (await send(owner.token, 'PATCH', `${base}/${id}`, { name: 'Đổi' })).body.error.code,
    ).toBe('PROJECT_ARCHIVED');
    expect(api.board.getProject(wsId, id)?.isArchived).toBe(true);
  });
});
