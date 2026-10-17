import type { APIRequestContext } from '@playwright/test';

import { awaiting, test, type E2EUser } from './fixtures';
import { call } from './http';

/**
 * Mốc 3.5 (ADR-140, test-spec-company §1.2) — người dùng E2E do Admin (Ada, bootstrap ở globalSetup) thêm qua
 * `POST hr/employees` rồi tự kích hoạt; workspace tạo tường minh. Chỉ API công khai.
 */

export type CompanyGrant = 'HR_MANAGE' | 'PAYROLL_MANAGE';

export interface Seeded {
  userId: string;
  accessToken: string;
  workspaceId: string;
  projectId: string;
}

/** Ada — Admin đầu tiên (globalSetup ghi vào process.env). */
export function adaUser(): E2EUser {
  const { E2E_ADA_ID: userId, E2E_ADA_EMAIL: email, E2E_ADA_PASSWORD: password } = process.env;
  if (!userId || !email || !password) {
    throw new Error('[hạ tầng E2E] thiếu phiên Ada — globalSetup chưa bootstrap Admin');
  }
  return { fullName: 'E2E Ada', email, password, userId };
}

/**
 * Access token của Ada. Access TTL E2E 10 s ⇒ giữ 7 s rồi đăng nhập lại; giữ PROMISE để các `apiCreateUser` song song
 * (Promise.all) không đăng nhập Ada nhiều lần (hạn mức login theo IP 127.0.0.1).
 */
let adaSession: { at: number; token: Promise<string> } | undefined;
export function adaToken(request: APIRequestContext): Promise<string> {
  if (!adaSession || Date.now() - adaSession.at > 7_000) {
    const ada = adaUser();
    const token = call<{ accessToken: string }>(
      request,
      'POST',
      '/auth/login',
      undefined,
      { email: ada.email, password: ada.password },
      200,
    ).then((r) => r.accessToken);
    adaSession = { at: Date.now(), token };
    token.catch(() => (adaSession = undefined));
  }
  return adaSession.token;
}

interface HireResponse {
  employee: { userId: string; version: number };
  activation: { token: string; link: string; expiresAt: string } | null;
}

/** `POST hr/employees` bởi Ada — trả nguyên response (token chỉ có một lần). */
export async function apiHire(
  request: APIRequestContext,
  user: E2EUser,
  startDate?: string,
): Promise<HireResponse> {
  return call<HireResponse>(
    request,
    'POST',
    '/hr/employees',
    await adaToken(request),
    { email: user.email, fullName: user.fullName, ...(startDate ? { startDate } : {}) },
    201,
  );
}

export function apiActivate(request: APIRequestContext, token: string, password: string) {
  return call<{ accessToken: string; user: { id: string } }>(
    request,
    'POST',
    '/auth/activate',
    undefined,
    { token, password },
    200,
  );
}

export async function apiSetAccess(
  request: APIRequestContext,
  userId: string,
  access: { role: 'ADMIN' | 'EMPLOYEE'; grants: CompanyGrant[]; expectedVersion: number },
) {
  return call<{ version: number }>(
    request,
    'PUT',
    `/admin/access/${userId}`,
    await adaToken(request),
    access,
    200,
  );
}

/**
 * Ada thêm `user` ⇒ kích hoạt bằng `user.password` ⇒ (tuỳ chọn) đổi role / grant. Gán `user.userId` (cho
 * `apiAddMember`). Đổi ROLE thu hồi phiên (B, ADR-105) ⇒ đăng nhập lại; đổi grant thì không.
 */
export async function apiCreateUser(
  request: APIRequestContext,
  user: E2EUser,
  opts: { grants?: CompanyGrant[]; admin?: boolean; startDate?: string } = {},
): Promise<{ userId: string; accessToken: string }> {
  test.fixme(
    Boolean(opts.admin || opts.grants?.length) && awaiting('T-061a'),
    '[PENDING T-061a] PUT admin/access (cấp HR_MANAGE / Admin) — API A',
  );
  const hired = await apiHire(request, user, opts.startDate);
  if (!hired.activation)
    throw new Error(`POST /hr/employees ${user.email}: email mới mà activation null`);
  user.userId = hired.employee.userId;
  let { accessToken } = await apiActivate(request, hired.activation.token, user.password);
  if (opts.admin || opts.grants?.length) {
    await apiSetAccess(request, user.userId, {
      role: opts.admin ? 'ADMIN' : 'EMPLOYEE',
      grants: opts.admin ? [] : (opts.grants ?? []),
      expectedVersion: hired.employee.version,
    });
    if (opts.admin) {
      ({ accessToken } = await call<{ accessToken: string }>(
        request,
        'POST',
        '/auth/login',
        undefined,
        { email: user.email, password: user.password },
        200,
      ));
    }
  }
  return { userId: user.userId, accessToken };
}

/** Người chờ kích hoạt — ca kích hoạt qua UI tự mở `link`. */
export async function apiCreatePending(request: APIRequestContext, user: E2EUser) {
  const hired = await apiHire(request, user);
  if (!hired.activation) throw new Error(`POST /hr/employees ${user.email}: activation null`);
  user.userId = hired.employee.userId;
  return { userId: hired.employee.userId, ...hired.activation };
}

export function apiNewWorkspace(request: APIRequestContext, ownerToken: string, name: string) {
  return call<{ id: string; slug: string }>(
    request,
    'POST',
    '/workspaces',
    ownerToken,
    { name },
    201,
  );
}

/** Tên / key của project mặc định mà `/auth/register` cũ tạo (FR-01) — giữ để các spec board không đổi. */
export const DEFAULT_PROJECT = { name: 'Dự án đầu tiên', keyPrefix: 'TF' } as const;

/**
 * Alias chuyển tiếp của `apiRegister` cũ (test-spec-company §1.2): `apiCreateUser` + `apiNewWorkspace` (tên
 * "Workspace của {fullName}" như register cũ) + project mặc định ⇒ cùng shape `Seeded`.
 */
export async function apiRegister(request: APIRequestContext, user: E2EUser): Promise<Seeded> {
  const { userId, accessToken } = await apiCreateUser(request, user);
  const ws = await apiNewWorkspace(request, accessToken, `Workspace của ${user.fullName}`);
  const project = await call<{ id: string }>(
    request,
    'POST',
    `/workspaces/${ws.id}/projects`,
    accessToken,
    DEFAULT_PROJECT,
    201,
  );
  return { userId, accessToken, workspaceId: ws.id, projectId: project.id };
}

export async function apiOffboard(
  request: APIRequestContext,
  hrToken: string,
  userId: string,
  lastDay: string,
) {
  return call<{ warnings: { soleOwnerWorkspaces: { id: string; name: string }[] } }>(
    request,
    'PUT',
    `/hr/employees/${userId}/offboarding`,
    hrToken,
    { lastDay },
    200,
  );
}
