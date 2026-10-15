import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, UpdateMeBody } from '@taskflow/contracts/auth';

import { authApi, session, sessionKeys } from '@/entities/session';

/** PATCH /auth/me (ADR-083) ⇒ cập nhật cache `['me']` và người dùng của phiên. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeBody) => authApi.updateMe(body),
    onSuccess: (user) => {
      queryClient.setQueryData<MeResponse>(sessionKeys.me, (old) => old && { ...old, user });
      session.updateUser(user);
    },
  });
}
