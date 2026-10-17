import {
  AuthTokenDto,
  ChangePasswordBody,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
  UpdateMeBody,
  UserDto,
} from '@taskflow/contracts/auth';
import { http, type HttpHandler } from 'msw';

import { MeWithCompanyResponse } from '@/shared/api/pending-contracts/company';

import type { MockDb } from './mock-db';
import { rejectsOrigin } from './request-guards';
import { authenticate as authenticateRequest } from './mock-guard';
import { fail, noContent, ok, parseBody, ruleViolation } from './respond';

// Handler /auth/* của mock API — hành vi theo data-and-api.md §2.4 và security.md §1, §2.3, §6.4–6.5.

const COOKIE = 'tf_rt';
/** Mẫu nhỏ của danh sách mật khẩu phổ biến (server thật dùng file ~10k mục — security.md §6.5). */
export const COMMON_PASSWORDS = new Set([
  'password1234',
  '123456789012',
  'qwertyuiop12',
  'matkhau12345',
]);
const LOGIN_FAILURE_LIMIT = 5;

const readCookie = (request: Request): string | undefined =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === COOKIE)?.[1];

/** `basePath` = pathname của API_URL (vd `/api/v1`) — cookie chỉ gửi cho `${basePath}/auth`. */
export const cookieHeader = (basePath: string, token: string | null) =>
  `${COOKIE}=${token ?? ''}; Path=${basePath}/auth; HttpOnly; SameSite=Strict; Max-Age=${token ? 30 * 86_400 : 0}`;

export function createAuthHandlers(
  baseUrl: string,
  db: MockDb,
  allowedOrigins: ReadonlySet<string>,
): HttpHandler[] {
  const url = (path: string) => `${baseUrl}${path}`;
  const basePath = new URL(baseUrl).pathname;
  const setCookie = (token: string | null) => ({ 'Set-Cookie': cookieHeader(basePath, token) });
  const loginFailures = new Map<string, number>();

  const authenticate = (request: Request) => {
    const auth = authenticateRequest(request, db);
    return auth.response ? { response: auth.response } : { user: auth.ok };
  };

  return [
    http.post(url('/auth/register'), async ({ request }) => {
      const body = await parseBody(request, RegisterBody);
      if (body.response) return body.response;
      const { email, password, fullName } = body.data;
      if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        return ruleViolation(
          'password',
          'common_password',
          'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác.',
        );
      }
      const localPart = email.split('@')[0] ?? '';
      if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
        return ruleViolation('password', 'contains_email', 'Mật khẩu không được chứa email.');
      }
      if (db.findUserByEmail(email)) return fail(409, 'EMAIL_ALREADY_EXISTS');
      const { user, defaultWorkspaceId } = db.createUser({ email, password, fullName });
      const tokens = db.issueAccess(user);
      return ok(
        RegisterResponse,
        { ...tokens, user: UserDto.parse(user), defaultWorkspaceId },
        { status: 201, headers: setCookie(db.issueRefresh(user.id)) },
      );
    }),

    http.post(url('/auth/login'), async ({ request }) => {
      const body = await parseBody(request, LoginBody);
      if (body.response) return body.response;
      const { email, password } = body.data;
      const failures = loginFailures.get(email) ?? 0;
      if (failures >= LOGIN_FAILURE_LIMIT) {
        return fail(
          429,
          'RATE_LIMITED',
          { retryAfterSec: 60 },
          { headers: { 'Retry-After': '60' } },
        );
      }
      const user = db.findUserByEmail(email);
      // ADR-137: chờ kích hoạt (mật khẩu rỗng) hoặc đã nghỉ (không thuộc công ty) ⇒ như sai thông tin.
      if (!user || user.password === '' || user.password !== password || !db.company.of(user.id)) {
        loginFailures.set(email, failures + 1);
        return fail(401, 'INVALID_CREDENTIALS');
      }
      loginFailures.delete(email);
      return ok(
        LoginResponse,
        { ...db.issueAccess(user), user: UserDto.parse(user) },
        { headers: setCookie(db.issueRefresh(user.id)) },
      );
    }),

    http.post(url('/auth/refresh'), ({ request }) => {
      const badOrigin = rejectsOrigin(request, allowedOrigins);
      if (badOrigin) return badOrigin;
      const result = db.rotateRefresh(readCookie(request));
      if (result.status === 'in-progress') return fail(409, 'REFRESH_IN_PROGRESS');
      const user = result.status === 'ok' ? db.getUser(result.userId) : undefined;
      if (result.status !== 'ok' || !user) {
        return fail(401, 'REFRESH_TOKEN_INVALID', null, { headers: setCookie(null) });
      }
      return ok(AuthTokenDto, db.issueAccess(user), { headers: setCookie(result.refreshToken) });
    }),

    http.post(url('/auth/logout'), ({ request }) => {
      const badOrigin = rejectsOrigin(request, allowedOrigins);
      if (badOrigin) return badOrigin;
      db.revokeRefresh(readCookie(request));
      return noContent({ headers: setCookie(null) });
    }),

    http.post(url('/auth/logout-all'), ({ request }) => {
      const auth = authenticate(request);
      if (auth.response) return auth.response;
      db.revokeAllSessions(auth.user.id, 'LOGOUT_ALL');
      return noContent({ headers: setCookie(null) });
    }),

    http.get(url('/auth/me'), ({ request }) => {
      const auth = authenticate(request);
      if (auth.response) return auth.response;
      const company = db.company.of(auth.user.id);
      // ADR-135: không thuộc công ty ⇒ 401 SESSION_REVOKED (không có "đăng nhập mà không thuộc công ty").
      if (!company) return fail(401, 'SESSION_REVOKED');
      return ok(MeWithCompanyResponse, {
        user: UserDto.parse(auth.user),
        memberships: db.membershipsOf(auth.user.id),
        company,
      });
    }),

    http.patch(url('/auth/me'), async ({ request }) => {
      const auth = authenticate(request);
      if (auth.response) return auth.response;
      const body = await parseBody(request, UpdateMeBody);
      if (body.response) return body.response;
      auth.user.fullName = body.data.fullName;
      return ok(UserDto, UserDto.parse(auth.user));
    }),

    http.post(url('/auth/change-password'), async ({ request }) => {
      const auth = authenticate(request);
      if (auth.response) return auth.response;
      const body = await parseBody(request, ChangePasswordBody);
      if (body.response) return body.response;
      if (body.data.currentPassword !== auth.user.password) {
        return fail(400, 'INVALID_CURRENT_PASSWORD');
      }
      auth.user.password = body.data.newPassword;
      db.revokeAllSessions(auth.user.id, 'PASSWORD_CHANGED');
      return ok(AuthTokenDto, db.issueAccess(auth.user), {
        headers: setCookie(db.issueRefresh(auth.user.id)),
      });
    }),
  ];
}
