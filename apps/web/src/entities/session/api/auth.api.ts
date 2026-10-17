import {
  AuthTokenDto,
  LoginResponse,
  MeResponse,
  UserDto,
  type ChangePasswordBody,
  type LoginBody,
  type UpdateMeBody,
} from '@taskflow/contracts/auth';
import * as z from 'zod';

import {
  ActivateResponse,
  ActivationInspectResponse,
  type ActivateBody,
} from '@taskflow/contracts/company';

import { cookieHttp, http } from '@/shared/api';

// Gọi /auth/* (data-and-api.md §2.4). Response parse bằng schema contracts trong `http`.
// refresh/logout dùng cookie ⇒ `cookieHttp` (không qua hàng đợi refresh của `http`).

const NoContent = z.undefined();

export const authApi = {
  login: (body: LoginBody) => http.post('/auth/login', { schema: LoginResponse, body }),
  refresh: () => cookieHttp.post('/auth/refresh', { schema: AuthTokenDto }),
  logout: () => cookieHttp.post('/auth/logout', { schema: NoContent }),
  logoutAll: () => http.post('/auth/logout-all', { schema: NoContent }),
  /** Kèm khối `company` (Mốc 3.5, ADR-135) — quyền công ty của trang chính / header. */
  me: () => http.get('/auth/me', { schema: MeResponse }),
  /** ADR-137: CHỈ ĐỌC — mở link / bot xem trước không tiêu token. Token đi trong body, không trong URL. */
  inspectActivation: (token: string) =>
    http.post('/auth/activation/inspect', { schema: ActivationInspectResponse, body: { token } }),
  /** Tiêu token + đặt mật khẩu ⇒ phiên mới như đăng nhập (cookie refresh theo `/auth/*`). */
  activate: (body: ActivateBody) => http.post('/auth/activate', { schema: ActivateResponse, body }),
  updateMe: (body: UpdateMeBody) => http.patch('/auth/me', { schema: UserDto, body }),
  changePassword: (body: ChangePasswordBody) =>
    http.post('/auth/change-password', { schema: AuthTokenDto, body }),
};

export type AuthApi = typeof authApi;
