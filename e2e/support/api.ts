import type { APIRequestContext } from '@playwright/test';

import { API_URL, WEB_ORIGIN } from './env';
import type { E2EUser } from './fixtures';
import { call } from './http';

export { apiRegister, type Seeded } from './company';
import type { Seeded } from './company';

export type Role = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';

/**
 * Mốc 3.5 (ADR-134): thêm theo `userId` người thuộc công ty — không còn `{email, role}`. `member` phải đã được tạo
 * bằng `apiCreateUser` / `apiRegister` (gán `userId` vào chính đối tượng E2EUser).
 */
export function apiAddMember(
  request: APIRequestContext,
  owner: Seeded,
  member: E2EUser,
  role: Role,
): Promise<unknown> {
  if (!member.userId)
    throw new Error(`apiAddMember: ${member.email} chưa được tạo (apiCreateUser)`);
  return call(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/members`,
    owner.accessToken,
    { userId: member.userId, role },
    201,
  );
}

export interface TaskRef {
  id: string;
  key: string;
  version: number;
}

export function apiCreateTask(
  request: APIRequestContext,
  owner: Seeded,
  title: string,
  description?: string,
): Promise<TaskRef> {
  return call<TaskRef>(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/projects/${owner.projectId}/tasks`,
    owner.accessToken,
    description === undefined ? { title } : { title, description },
    201,
  );
}

export const boardPath = (s: Pick<Seeded, 'workspaceId' | 'projectId'>) =>
  `/w/${s.workspaceId}/p/${s.projectId}`;

export function apiLogin(
  request: APIRequestContext,
  user: E2EUser,
): Promise<{ accessToken: string }> {
  return call(
    request,
    'POST',
    '/auth/login',
    undefined,
    { email: user.email, password: user.password },
    200,
  );
}

const taskPath = (s: Seeded, taskId: string) =>
  `/workspaces/${s.workspaceId}/projects/${s.projectId}/tasks/${taskId}`;

export function apiMoveTask(
  request: APIRequestContext,
  s: Seeded,
  task: TaskRef,
  status: string,
): Promise<TaskRef> {
  return call(
    request,
    'PATCH',
    `${taskPath(s, task.id)}/move`,
    s.accessToken,
    { expectedVersion: task.version, status },
    200,
  );
}

export function apiAssign(
  request: APIRequestContext,
  s: Seeded,
  task: TaskRef,
  assigneeId: string | null,
): Promise<TaskRef> {
  return call(
    request,
    'PATCH',
    `${taskPath(s, task.id)}/assignee`,
    s.accessToken,
    { expectedVersion: task.version, assigneeId },
    200,
  );
}

export function apiChangeRole(
  request: APIRequestContext,
  owner: Seeded,
  userId: string,
  role: Role,
): Promise<unknown> {
  return call(
    request,
    'PATCH',
    `/workspaces/${owner.workspaceId}/members/${userId}`,
    owner.accessToken,
    { role },
    200,
  );
}

export async function apiRemoveMember(
  request: APIRequestContext,
  owner: Seeded,
  userId: string,
): Promise<void> {
  const res = await request.delete(`${API_URL}/workspaces/${owner.workspaceId}/members/${userId}`, {
    headers: { origin: WEB_ORIGIN, authorization: `Bearer ${owner.accessToken}` },
  });
  if (!res.ok())
    throw new Error(`DELETE member — ${String(res.status())}: ${(await res.text()).slice(0, 300)}`);
}

export function apiArchiveProject(request: APIRequestContext, owner: Seeded): Promise<unknown> {
  return call(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/projects/${owner.projectId}/archive`,
    owner.accessToken,
    undefined,
    200,
  );
}

export async function apiDeleteWorkspace(request: APIRequestContext, owner: Seeded): Promise<void> {
  const ws = await call<{ slug: string }>(
    request,
    'GET',
    `/workspaces/${owner.workspaceId}`,
    owner.accessToken,
    undefined,
    200,
  );
  await call(
    request,
    'DELETE',
    `/workspaces/${owner.workspaceId}`,
    owner.accessToken,
    { confirmSlug: ws.slug },
    200,
  );
}

export function apiRestoreWorkspace(request: APIRequestContext, owner: Seeded): Promise<unknown> {
  return call(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/restore`,
    owner.accessToken,
    undefined,
    200,
  );
}

export interface TaskFull extends TaskRef {
  title: string;
  status: string;
  rank: string;
}

export function apiGetTask(
  request: APIRequestContext,
  s: Seeded,
  taskId: string,
): Promise<TaskFull> {
  return call(request, 'GET', taskPath(s, taskId), s.accessToken, undefined, 200);
}

/**
 * Move tới vị trí giữa `afterId` và `beforeId` trong cùng cột. `known` = version đang biết (từ response
 * trước) ⇒ không GET mỗi lần (GET + PATCH gấp đôi request ⇒ 429 ở bucket 1000/phút). Rebalance đổi
 * version các thẻ khác ⇒ 409 ⇒ lấy version mới rồi thử lại một lần.
 */
export async function apiMoveBetween(
  request: APIRequestContext,
  s: Seeded,
  taskId: string,
  afterId: string | null,
  beforeId: string | null,
  known?: number,
): Promise<TaskFull> {
  const send = (expectedVersion: number) =>
    request.fetch(`${API_URL}${taskPath(s, taskId)}/move`, {
      method: 'PATCH',
      headers: {
        origin: WEB_ORIGIN,
        'content-type': 'application/json',
        authorization: `Bearer ${s.accessToken}`,
      },
      data: JSON.stringify({ expectedVersion, afterId, beforeId }),
    });
  let res = await send(known ?? (await apiGetTask(request, s, taskId)).version);
  if (res.status() === 409) res = await send((await apiGetTask(request, s, taskId)).version);
  // Kịch bản cần vài trăm move/phút > hạn mức `api-user` 300/phút (đúng thiết kế). Valkey db của E2E là
  // riêng ⇒ xóa bộ đếm rồi thử lại — CHỈ để dựng dữ liệu, không phải kiểm rate limit.
  if (res.status() === 429) {
    await (await import('./fixtures')).flushValkey();
    res = await send((await apiGetTask(request, s, taskId)).version);
  }
  if (res.status() !== 200) {
    throw new Error(`PATCH move — ${String(res.status())}: ${(await res.text()).slice(0, 300)}`);
  }
  return ((await res.json()) as { data: TaskFull }).data;
}

export function apiGetWorkspace(
  request: APIRequestContext,
  s: Seeded,
): Promise<{ name: string; slug: string }> {
  return call(request, 'GET', `/workspaces/${s.workspaceId}`, s.accessToken, undefined, 200);
}

export function apiRenameWorkspace(
  request: APIRequestContext,
  owner: Seeded,
  name: string,
): Promise<unknown> {
  return call(
    request,
    'PATCH',
    `/workspaces/${owner.workspaceId}`,
    owner.accessToken,
    { name },
    200,
  );
}

export function apiCreateProject(
  request: APIRequestContext,
  owner: Seeded,
  name: string,
  keyPrefix: string,
): Promise<{ id: string }> {
  return call<{ id: string }>(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/projects`,
    owner.accessToken,
    { name, keyPrefix },
    201,
  );
}
