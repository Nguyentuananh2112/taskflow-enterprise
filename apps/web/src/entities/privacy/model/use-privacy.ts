import { useQuery } from '@tanstack/react-query';

import { privacyApi } from '../api/privacy.api';

/** Dưới gốc ['company'] — đăng xuất / SESSION_REVOKED ⇒ `queryClient.clear()` dọn cùng. */
export const privacyKeys = { me: () => ['company', 'privacy', 'me'] as const };

export function usePrivacy(enabled = true) {
  return useQuery({
    queryKey: privacyKeys.me(),
    queryFn: privacyApi.me,
    enabled,
    staleTime: 60_000,
  });
}
