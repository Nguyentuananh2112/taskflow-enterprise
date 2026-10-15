import { useQuery } from '@tanstack/react-query';

import { authApi } from '../api/auth.api';
import { useSession } from './use-session';

export const sessionKeys = {
  /** `MeResponse` (frontend.md §3.2) — invalidate khi tạo/rời workspace, đổi role, sửa hồ sơ. */
  me: ['me'] as const,
};

/** Hồ sơ + membership của tôi; chỉ chạy khi đã đăng nhập. */
export function useMe() {
  const { status } = useSession();
  return useQuery({
    queryKey: sessionKeys.me,
    queryFn: authApi.me,
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });
}
