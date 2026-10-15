import { NextResponse, type NextRequest } from 'next/server';

import { readPublicRuntimeConfig } from '@/app/config/server-env';
import { buildSecurityHeaders, createNonce } from '@/app/security/csp';

// Next 16: middleware.ts → proxy.ts, đặt ở gốc apps/web vì app/ nằm ở gốc (frontend.md §2.1, V1).
// CSP nonce theo https://nextjs.org/docs/app/guides/content-security-policy (V2):
// đặt x-nonce + CSP lên REQUEST headers để Next tự gắn nonce cho script/style nó sinh ra,
// và đặt CSP + header W-CSP-4 lên RESPONSE.
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const { apiUrl, wsUrl, appEnv } = readPublicRuntimeConfig();
  const headers = buildSecurityHeaders({
    nonce,
    apiUrl,
    wsUrl,
    isDev: process.env.NODE_ENV === 'development',
    appEnv,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy'] ?? '');

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  // Bỏ qua file tĩnh và route JSON (healthz): không có HTML nên không cần nonce.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
};
