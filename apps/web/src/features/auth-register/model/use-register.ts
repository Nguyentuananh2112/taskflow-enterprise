import { useMutation } from '@tanstack/react-query';
import type { RegisterBody } from '@taskflow/contracts/auth';

import { authApi, session } from '@/entities/session';

/** POST /auth/register ⇒ đăng nhập luôn (server cấp token + cookie). */
export function useRegister() {
  return useMutation({
    mutationFn: (body: RegisterBody) => authApi.register(body),
    onSuccess: ({ accessToken, expiresIn, user }) =>
      session.signIn({ accessToken, expiresIn }, user),
  });
}
