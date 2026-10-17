import { UserDto } from '@taskflow/contracts/auth';
import {
  ActivateBody,
  ActivateResponse,
  ActivationInspectBody,
  ActivationInspectResponse,
} from '@taskflow/contracts/company';
import { http, type HttpHandler } from 'msw';

import { COMMON_PASSWORDS, cookieHeader } from './auth-handlers';
import type { MockDb } from './mock-db';
import { fail, ok, parseBody } from './respond';

// Kích hoạt tài khoản (ADR-137 điều khoản token, B1–B7 của E): công khai. `inspect` CHỈ ĐỌC (bot xem trước link không
// làm hỏng link); chỉ `activate` tiêu token. Token sai / rác ⇒ cùng một 400 ACTIVATION_INVALID; đã dùng / hết hạn /
// thu hồi ⇒ 410 ACTIVATION_GONE. Mật khẩu yếu ⇒ 422, token VẪN sống.

export function createActivationHandlers(baseUrl: string, db: MockDb): HttpHandler[] {
  const url = (path: string) => `${baseUrl}${path}`;
  const basePath = new URL(baseUrl).pathname;
  const resolve = (token: string) => {
    const hit = db.company.lookup(token, db.now());
    if (hit === 'invalid') return { response: fail(400, 'ACTIVATION_INVALID') };
    if (hit === 'gone') return { response: fail(410, 'ACTIVATION_GONE') };
    const user = db.getUser(hit.userId);
    return user ? { user } : { response: fail(400, 'ACTIVATION_INVALID') };
  };

  return [
    http.post(url('/auth/activation/inspect'), async ({ request }) => {
      const body = await parseBody(request, ActivationInspectBody);
      if (body.response) return body.response;
      const hit = resolve(body.data.token);
      if (hit.response) return hit.response;
      return ok(
        ActivationInspectResponse,
        { fullName: hit.user.fullName, email: hit.user.email, companyName: db.company.name },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }),

    http.post(url('/auth/activate'), async ({ request }) => {
      const body = await parseBody(request, ActivateBody);
      if (body.response) return body.response;
      const { token, password } = body.data;
      const hit = resolve(token);
      if (hit.response) return hit.response;
      const { user } = hit;
      // PasswordPolicy (kèm email) — 422 với `details.issues` như lỗi validate ⇒ web gắn vào ô mật khẩu.
      const weak = (code: string, message: string) =>
        fail(422, 'VALIDATION_ERROR', { issues: [{ path: ['password'], code, message }] });
      if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        return weak('common_password', 'Mật khẩu quá phổ biến.');
      }
      const local = user.email.split('@')[0]?.toLowerCase() ?? '';
      if (local.length >= 3 && password.toLowerCase().includes(local)) {
        return weak('contains_email', 'Mật khẩu không được chứa email.');
      }
      db.company.consume(token, db.now());
      user.password = password;
      return ok(
        ActivateResponse,
        { ...db.issueAccess(user), user: UserDto.parse(user) },
        { headers: { 'Set-Cookie': cookieHeader(basePath, db.issueRefresh(user.id)) } },
      );
    }),
  ];
}
