import { QueryClientProvider } from '@tanstack/react-query';
import { applyVietnameseZodLocale } from '@taskflow/contracts/common';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { session } from '@/entities/session';
import { createQueryClient } from '@/shared/query';
import { Toaster, resetToastsForTest } from '@/shared/ui/toast';

// Render component cần TanStack Query + Toaster như trong app (src/app/providers).
applyVietnameseZodLocale();

export function renderWithProviders(ui: ReactElement) {
  const queryClient = createQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/** Dọn sau mỗi test: DOM, toast, phiên (mô phỏng tab mới). */
export function cleanupApp(): void {
  cleanup();
  act(() => {
    resetToastsForTest();
    session.resetForTest();
  });
}
