import type { AppEnv } from '@/shared/config';

// Header bảo mật của web — hiện thực security.md §6.8 (W-CSP-1..4). Hàm thuần để test được;
// proxy.ts gọi mỗi request. Policy là của security.md, đổi ở đây phải đổi ở đó trước.

/** W-CSP-1: 16 byte từ CSPRNG (128 bit) → base64. Không dùng randomUUID (chỉ 122 bit ngẫu nhiên). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

type CspInput = Readonly<{
  nonce: string;
  /** API_URL lúc chạy (gồm /api/v1) — chỉ lấy origin. */
  apiUrl: string;
  /** WS_URL lúc chạy (origin http/https) — đổi sang ws/wss. */
  wsUrl: string;
  /** NODE_ENV=development — chỉ quyết định phần nới cho HMR (W-CSP-3). */
  isDev: boolean;
  /** APP_ENV lúc chạy — quyết định ép HTTPS (ADR-101). */
  appEnv: AppEnv;
}>;

/**
 * ADR-101: `upgrade-insecure-requests` + HSTS chỉ ở môi trường chạy HTTPS thật. Theo APP_ENV, không
 * theo NODE_ENV: build prod chạy http (E2E Docker, host khác localhost) không bị nâng lên https và gãy.
 */
export const enforcesHttps = (appEnv: AppEnv) => appEnv === 'staging' || appEnv === 'production';

const toWsOrigin = (url: string) => new URL(url).origin.replace(/^http/, 'ws');

/** W-CSP-2 (prod) + W-CSP-3 (dev). */
export function buildCsp({ nonce, apiUrl, wsUrl, isDev, appEnv }: CspInput): string {
  const connect = new Set(["'self'", new URL(apiUrl).origin, toWsOrigin(wsUrl)]);
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) {
    // W-CSP-3: chỉ khi development, cho HMR.
    script.push("'unsafe-eval'");
    connect.add('ws://localhost:*');
    connect.add('http://localhost:4000');
  }
  const directives = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${[...connect].join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (enforcesHttps(appEnv)) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** W-CSP-4: header khác cho mọi response HTML. HSTS chỉ khi ép HTTPS (ADR-101). */
export function buildSecurityHeaders(input: CspInput): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildCsp(input),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (enforcesHttps(input.appEnv)) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}
