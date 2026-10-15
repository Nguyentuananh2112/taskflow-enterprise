'use client';

import { setNonce } from 'get-nonce';
import type { ReactNode } from 'react';
import * as z from 'zod';
import { vi } from 'zod/locales';

import { RuntimeConfigBoot, type PublicRuntimeConfig } from '@/shared/config';
import { Toaster } from '@/shared/ui/toast';

// Thông báo validate tiếng Việt cho mọi schema (kể cả từ @taskflow/contracts) — ADR-081, frontend.md §7.2.
z.config(vi());

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
  return (
    <RuntimeConfigBoot config={config}>
      {children}
      <Toaster />
    </RuntimeConfigBoot>
  );
}
