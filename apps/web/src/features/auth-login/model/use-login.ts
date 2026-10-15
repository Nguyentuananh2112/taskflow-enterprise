import { useMutation } from '@tanstack/react-query';
import type { LoginBody } from '@taskflow/contracts/auth';

import { authApi, session } from '@/entities/session';

/** POST /auth/login ⇒ phiên mới. Điều hướng sau đăng nhập do GuestGate lo (một chỗ duy nhất). */
export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginBody) => authApi.login(body),
    onSuccess: ({ accessToken, expiresIn, user }) =>
      session.signIn({ accessToken, expiresIn }, user),
  });
}
