'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { applyVietnameseZodLocale } from '@taskflow/contracts/common';
import { setNonce } from 'get-nonce';
import { useState, type ReactNode } from 'react';

import { RuntimeConfigBoot, type PublicRuntimeConfig } from '@/shared/config';
import { createQueryClient } from '@/shared/query';
import { Toaster } from '@/shared/ui/toast';

import { SessionEffects } from './session-effects';

// Thông báo validate tiếng Việt cho mọi schema (kể cả từ @taskflow/contracts) — ADR-081, frontend.md §7.2.
applyVietnameseZodLocale();

type Props = Readonly<{
  config: PublicRuntimeConfig;
  /** Nonce CSP của request (x-nonce từ proxy.ts). */
  nonce: string | undefined;
  children: ReactNode;
}>;

/**
 * Provider gốc của toàn app. Thứ tự: nonce + runtime config được nạp TRONG LÚC RENDER, trước con,
 * để code chạy ở lần render đầu đã thấy chúng.
 */
export function AppProviders({ config, nonce, children }: Props) {
  // Radix (khóa cuộn của Dialog/Drawer) chèn <style> qua react-style-singleton → get-nonce:
  // gắn nonce để không bị CSP style-src chặn (W-CSP-2).
  if (nonce) setNonce(nonce);
  // Mỗi lần mount một QueryClient (không dùng chung giữa các request ở server).
  const [queryClient] = useState(createQueryClient);
  return (
    <RuntimeConfigBoot config={config}>
      <QueryClientProvider client={queryClient}>
        <SessionEffects />
        {children}
        <Toaster />
      </QueryClientProvider>
    </RuntimeConfigBoot>
  );
}
