import {
  AuthTokenDto,
  LoginResponse,
  MeResponse,
  RegisterResponse,
  UserDto,
  type ChangePasswordBody,
  type LoginBody,
  type RegisterBody,
  type UpdateMeBody,
} from '@taskflow/contracts/auth';
import * as z from 'zod';

import { cookieHttp, http } from '@/shared/api';

// Gọi /auth/* (data-and-api.md §2.4). Response parse bằng schema contracts trong `http`.
// refresh/logout dùng cookie ⇒ `cookieHttp` (không qua hàng đợi refresh của `http`).

const NoContent = z.undefined();

export const authApi = {
  register: (body: RegisterBody) => http.post('/auth/register', { schema: RegisterResponse, body }),
  login: (body: LoginBody) => http.post('/auth/login', { schema: LoginResponse, body }),
  refresh: () => cookieHttp.post('/auth/refresh', { schema: AuthTokenDto }),
  logout: () => cookieHttp.post('/auth/logout', { schema: NoContent }),
  logoutAll: () => http.post('/auth/logout-all', { schema: NoContent }),
  me: () => http.get('/auth/me', { schema: MeResponse }),
  updateMe: (body: UpdateMeBody) => http.patch('/auth/me', { schema: UserDto, body }),
  changePassword: (body: ChangePasswordBody) =>
    http.post('/auth/change-password', { schema: AuthTokenDto, body }),
};

export type AuthApi = typeof authApi;
