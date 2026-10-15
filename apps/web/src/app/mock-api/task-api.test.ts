import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import type { BoardEvent } from './mock-board';
import { getResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMockApi } from './index';

// Mock task API phải "khó tính" như server (data-and-api §2.7, §6.2): thứ tự lỗi, state machine,
// version trước no-op (ADR-091), quyền MEMBER (ADR-041), archived (ADR-045), event có originClientId.

const BASE = 'http://localhost:4000/api/v1';
const TAB = '0199e5a2-0000-7000-8000-00000000c1e1';

type Json = {
  data: Record<string, unknown> & { id: string; version: number };
  error: { code: string; details: Record<string, unknown> };
};

function setup() {
  const api = createMockApi(BASE);
  const events: BoardEvent[] = [];
  api.board.onEvent((e) => events.push(e));
  const send = async (token: string, method: string, path: string, body?: unknown) => {
    const response = await getResponse(
      api.handlers,
      new Request(BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-client-id': TAB,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (!response) throw new Error(`không có handler: ${method} ${path}`);
    return { status: response.status, body: (await response.json()) as Json };
  };
  const owner = api.db.createUser({
    email: 'lan@example.com',
    password: 'x',
    fullName: 'Trần Lan',
  });
  const ownerToken = api.db.issueAccess(owner.user).accessToken;
  const wsId = owner.defaultWorkspaceId;
  const project = api.board.listProjects(wsId, 'false')[0]!;
  const tasks = `/workspaces/${wsId}/projects/${project.id}/tasks`;
  const membership = api.db.membershipIn(owner.user.id, wsId)!;
  const addUser = (email: string, role: WorkspaceRole) => {
    const { user } = api.db.createUser({ email, password: 'x', fullName: email });
    api.db.setMembership(user.id, membership, role);
    return { user, token: api.db.issueAccess(user).accessToken };
  };
  const create = async (title: string, token = ownerToken) =>
    (await send(token, 'POST', tasks, { title })).body.data;
  return {
    api,
    events,
    send,
    ownerToken,
    owner: owner.user,
    wsId,
    project,
    tasks,
    addUser,
    create,
  };
}

describe('mock task API', () => {
  it('workspace mặc định có project "Dự án đầu tiên" (TF); task mới cuối cột TODO, mã TF-n', async () => {
    const { project, create } = setup();
    expect(project).toMatchObject({ name: 'Dự án đầu tiên', keyPrefix: 'TF' });
    const one = await create('Việc một');
    const two = await create('Việc hai');
    expect(one).toMatchObject({ key: 'TF-101', status: 'TODO', version: 1 });
    expect(String(two.rank) > String(one.rank)).toBe(true);
  });

  it('move sai state machine ⇒ 422 INVALID_STATUS_TRANSITION kèm allowed', async () => {
    const { send, ownerToken, tasks, create } = setup();
    const t = await create('Việc');
    const res = await send(ownerToken, 'PATCH', `${tasks}/${t.id}/move`, {
      expectedVersion: 1,
      status: 'DONE',
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
      details: { from: 'TODO', to: 'DONE', allowed: ['IN_PROGRESS'] },
    });
  });

  it('move hợp lệ: version+1, event task:moved có originClientId của tab', async () => {
    const { send, ownerToken, tasks, create, events } = setup();
    const t = await create('Việc');
    const res = await send(ownerToken, 'PATCH', `${tasks}/${t.id}/move`, {
      expectedVersion: 1,
      status: 'IN_PROGRESS',
      afterId: null,
      beforeId: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'IN_PROGRESS', version: 2 });
    const moved = events.find((e) => e.name === 'task:moved');
    expect(moved?.payload).toMatchObject({
      originClientId: TAB,
      data: { from: { status: 'TODO' }, to: { status: 'IN_PROGRESS' } },
    });
  });

  it('anchor khác cột đích ⇒ 422 INVALID_ANCHOR', async () => {
    const { send, ownerToken, tasks, create } = setup();
    const a = await create('Việc A');
    const b = await create('Việc B');
    const res = await send(ownerToken, 'PATCH', `${tasks}/${a.id}/move`, {
      expectedVersion: 1,
      status: 'IN_PROGRESS',
      afterId: b.id,
    });
    expect(res.body.error).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { rule: 'INVALID_ANCHOR' },
    });
  });

  it('version cũ ⇒ 409 kèm details.current; version kiểm TRƯỚC no-op (ADR-091)', async () => {
    const { send, ownerToken, tasks, create } = setup();
    const t = await create('Việc');
    await send(ownerToken, 'PATCH', `${tasks}/${t.id}`, { expectedVersion: 1, title: 'Đổi tên' });
    const noopOld = await send(ownerToken, 'PATCH', `${tasks}/${t.id}`, {
      expectedVersion: 1,
      title: 'Đổi tên',
    });
    expect(noopOld.status).toBe(409);
    expect(noopOld.body.error.details).toMatchObject({
      currentVersion: 2,
      current: { title: 'Đổi tên', version: 2 },
    });
    const noop = await send(ownerToken, 'PATCH', `${tasks}/${t.id}`, {
      expectedVersion: 2,
      title: 'Đổi tên',
    });
    expect(noop.body.data.version).toBe(2); // R15: no-op không tăng version
  });

  it('MEMBER: tạo task gán người khác ⇒ 403; tự nhận task trống ⇒ ok; VIEWER không được assignee (422)', async () => {
    const { send, tasks, create, addUser } = setup();
    const member = addUser('an@example.com', 'MEMBER');
    const viewer = addUser('khang@example.com', 'VIEWER');
    const other = addUser('hoa@example.com', 'MEMBER');
    const forbidden = await send(member.token, 'POST', tasks, {
      title: 'Giao người khác',
      assigneeId: other.user.id,
    });
    expect(forbidden.status).toBe(403);
    const t = await create('Task của owner');
    const claim = await send(member.token, 'PATCH', `${tasks}/${t.id}/assignee`, {
      expectedVersion: 1,
      assigneeId: member.user.id,
    });
    expect(claim.status).toBe(200);
    const toViewer = await send(member.token, 'POST', tasks, { title: 'Việc của An' });
    const ownTask = toViewer.body.data;
    const res = await send(member.token, 'PATCH', `${tasks}/${ownTask.id}/assignee`, {
      expectedVersion: 1,
      assigneeId: viewer.user.id,
    });
    expect(res.body.error).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { rule: 'ASSIGNEE_NOT_MEMBER' },
    });
  });

  it('VIEWER: tạo/move ⇒ 403; MEMBER xóa task người khác ⇒ 403', async () => {
    const { send, tasks, create, addUser } = setup();
    const viewer = addUser('khang@example.com', 'VIEWER');
    const member = addUser('an@example.com', 'MEMBER');
    expect((await send(viewer.token, 'POST', tasks, { title: 'Không được' })).status).toBe(403);
    const t = await create('Của owner');
    expect(
      (
        await send(viewer.token, 'PATCH', `${tasks}/${t.id}/move`, {
          expectedVersion: 1,
          status: 'IN_PROGRESS',
        })
      ).status,
    ).toBe(403);
    expect((await send(member.token, 'DELETE', `${tasks}/${t.id}?expectedVersion=1`)).status).toBe(
      403,
    );
  });

  it('project lưu trữ ⇒ 422 PROJECT_ARCHIVED cho tạo/sửa/move/xóa; project:updated được phát', async () => {
    const { send, ownerToken, tasks, create, wsId, project, events } = setup();
    const t = await create('Việc');
    await send(ownerToken, 'POST', `/workspaces/${wsId}/projects/${project.id}/archive`);
    expect(events.some((e) => e.name === 'project:updated')).toBe(true);
    const results = await Promise.all([
      send(ownerToken, 'POST', tasks, { title: 'Mới' }),
      send(ownerToken, 'PATCH', `${tasks}/${t.id}`, { expectedVersion: 1, title: 'Sửa' }),
      send(ownerToken, 'PATCH', `${tasks}/${t.id}/move`, {
        expectedVersion: 1,
        status: 'IN_PROGRESS',
      }),
      send(ownerToken, 'DELETE', `${tasks}/${t.id}?expectedVersion=1`),
    ]);
    expect(results.map((r) => r.body.error.code)).toEqual(Array(4).fill('PROJECT_ARCHIVED'));
  });

  it('xóa: version+1, task biến khỏi list/GET (404) nhưng lịch sử vẫn đọc được', async () => {
    const { send, ownerToken, tasks, create, events } = setup();
    const t = await create('Việc');
    const del = await send(ownerToken, 'DELETE', `${tasks}/${t.id}?expectedVersion=1`);
    expect(del.body.data).toEqual({ id: t.id, version: 2 });
    expect((await send(ownerToken, 'GET', `${tasks}/${t.id}`)).status).toBe(404);
    const logs = await send(ownerToken, 'GET', `${tasks}/${t.id}/audit-logs`);
    const actions = (logs.body.data as unknown as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toEqual(['DELETED', 'CREATED']);
    expect(events.at(-1)).toMatchObject({
      name: 'task:deleted',
      payload: { data: { taskId: t.id, version: 2 } },
    });
  });

  it('không phải thành viên ⇒ 404 (không lộ tồn tại); id không phải uuid ⇒ 400', async () => {
    const { api, send, tasks } = setup();
    const stranger = api.db.createUser({
      email: 'la@example.com',
      password: 'x',
      fullName: 'Người lạ',
    });
    const token = api.db.issueAccess(stranger.user).accessToken;
    expect((await send(token, 'GET', tasks)).status).toBe(404);
    expect((await send(token, 'GET', '/workspaces/abc/projects')).status).toBe(400);
  });

  it('danh sách phân trang theo cursor', async () => {
    const { send, ownerToken, tasks, create } = setup();
    for (const title of ['Việc 1', 'Việc 2', 'Việc 3']) await create(title);
    const first = await send(ownerToken, 'GET', `${tasks}?limit=2`);
    const meta = (
      first.body as unknown as { meta: { page: { hasMore: boolean; nextCursor: string } } }
    ).meta.page;
    expect(meta.hasMore).toBe(true);
    const second = await send(ownerToken, 'GET', `${tasks}?limit=2&cursor=${meta.nextCursor}`);
    expect((second.body.data as unknown as unknown[]).length).toBe(1);
  });
});
