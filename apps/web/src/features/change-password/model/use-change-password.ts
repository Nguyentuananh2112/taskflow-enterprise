import { useMutation } from '@tanstack/react-query';
import type { ChangePasswordBody } from '@taskflow/contracts/auth';

import { authApi, session } from '@/entities/session';

/**
 * POST /auth/change-password (security.md §1.7): server thu hồi mọi phiên khác và cấp token mới
 * cho thiết bị này ⇒ thay token trong bộ nhớ, phiên tiếp tục.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordBody) => authApi.changePassword(body),
    onSuccess: (token) => session.replaceToken(token),
  });
}
