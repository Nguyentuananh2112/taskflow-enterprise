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
    ...(method === 'GET' ? {} : { data: body === undefined ? '' : JSON.stringify(body) }),
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
