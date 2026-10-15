import type { APIRequestContext } from '@playwright/test';

import { API_URL, WEB_ORIGIN } from './env';
import type { E2EUser } from './fixtures';

// Seed dữ liệu CHỈ qua API công khai (T-026 mục 1) — không chọc DB. Origin + JSON như trình duyệt thật
// (CSRF/415 của API). Mỗi lời gọi trả lỗi rõ khi status sai để test không đỏ mơ hồ.

export type Role = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER';

async function call<T>(
  request: APIRequestContext,
  method: string,
  path: string,
  token: string | undefined,
  body: unknown,
  expected: number,
): Promise<T> {
  const res = await request.fetch(`${API_URL}${path}`, {
    method,
    headers: {
      origin: WEB_ORIGIN,
      // GET không có body (body rỗng + JSON ⇒ 400 invalid_json); POST/PATCH bắt buộc JSON (415).
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    // Không có body ⇒ không gửi `data` (chuỗi rỗng bị coi là JSON hỏng ⇒ 400 invalid_json).
    ...(method === 'GET' || body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  if (res.status() !== expected) {
    throw new Error(
      `${method} ${path} — mong đợi ${String(expected)}, nhận ${String(res.status())}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  return ((await res.json()) as { data: T }).data;
}

export interface Seeded {
  userId: string;
  accessToken: string;
  workspaceId: string;
  projectId: string;
}

/** Đăng ký qua API: user + workspace mặc định + project mặc định (FR-01). */
export async function apiRegister(request: APIRequestContext, user: E2EUser): Promise<Seeded> {
  const reg = await call<{ accessToken: string; user: { id: string }; defaultWorkspaceId: string }>(
    request,
    'POST',
    '/auth/register',
    undefined,
    { email: user.email, password: user.password, fullName: user.fullName },
    201,
  );
  const projects = await call<{ items: { id: string }[] } | { id: string }[]>(
    request,
    'GET',
    `/workspaces/${reg.defaultWorkspaceId}/projects`,
    reg.accessToken,
    undefined,
    200,
  );
  const list = Array.isArray(projects) ? projects : projects.items;
  const projectId = list[0]?.id;
  if (!projectId) throw new Error('workspace mặc định không có project mặc định');
  return {
    userId: reg.user.id,
    accessToken: reg.accessToken,
    workspaceId: reg.defaultWorkspaceId,
    projectId,
  };
}

export function apiAddMember(
  request: APIRequestContext,
  owner: Seeded,
  member: E2EUser,
  role: Role,
): Promise<unknown> {
  return call(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/members`,
    owner.accessToken,
    { email: member.email, role },
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
): Promise<TaskRef> {
  return call<TaskRef>(
    request,
    'POST',
    `/workspaces/${owner.workspaceId}/projects/${owner.projectId}/tasks`,
    owner.accessToken,
    { title },
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

/** Move tới vị trí giữa `afterId` và `beforeId` trong cùng cột; version lấy mới từ server (rebalance đổi version). */
export async function apiMoveBetween(
  request: APIRequestContext,
  s: Seeded,
  taskId: string,
  afterId: string | null,
  beforeId: string | null,
): Promise<TaskFull> {
  const current = await apiGetTask(request, s, taskId);
  return call(
    request,
    'PATCH',
    `${taskPath(s, taskId)}/move`,
    s.accessToken,
    { expectedVersion: current.version, afterId, beforeId },
    200,
  );
}
