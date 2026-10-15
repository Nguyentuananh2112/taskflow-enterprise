import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/shared/api';

/** Mặc định QueryClient (frontend.md §3.1): không retry 4xx, mutation không tự retry. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (count, error) => count < 2 && (!isApiError(error) || error.status >= 500),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
