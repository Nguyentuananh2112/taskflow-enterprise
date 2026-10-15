'use client';

import { createContext, use, type ReactNode } from 'react';

// Nonce CSP của request (x-nonce do proxy.ts sinh, root layout truyền xuống AppProviders) cho thư viện
// chèn <style> lúc chạy (vd StyleInjector của @dnd-kit/dom khi kéo thả). KHÔNG nới CSP thay cho việc
// này (security.md §6.8 W-CSP-2). Radix nhận nonce riêng qua get-nonce (AppProviders).

const NonceContext = createContext<string | undefined>(undefined);

export function CspNonceProvider({
  nonce,
  children,
}: Readonly<{ nonce: string | undefined; children: ReactNode }>) {
  return <NonceContext value={nonce}>{children}</NonceContext>;
}

/** `undefined` ngoài trình duyệt có CSP (test, dev không proxy) — thư viện khi đó chèn style không nonce. */
export function useCspNonce(): string | undefined {
  return use(NonceContext);
}
