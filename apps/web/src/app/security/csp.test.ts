import { describe, expect, it } from 'vitest';

import { buildCsp, buildSecurityHeaders, createNonce, enforcesHttps } from './csp';

const PROD = {
  nonce: 'bm9uY2U=',
  apiUrl: 'https://api.example.com/api/v1',
  wsUrl: 'https://api.example.com',
  isDev: false,
  appEnv: 'production',
} as const;

const directive = (csp: string, name: string) =>
  csp
    .split('; ')
    .find((d) => d.startsWith(`${name} `) || d === name)
    ?.split(' ')
    .slice(1);

describe('createNonce (W-CSP-1)', () => {
  it('128 bit: 16 byte base64 = 24 ký tự, kết thúc "=="', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it('mỗi lần một giá trị mới', () => {
    const nonces = new Set(Array.from({ length: 200 }, createNonce));
    expect(nonces.size).toBe(200);
  });
});

describe('buildCsp — production (W-CSP-2)', () => {
  const csp = buildCsp(PROD);

  it('đủ directive theo security.md §6.8', () => {
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'script-src')).toEqual([
      "'self'",
      "'nonce-bm9uY2U='",
      "'strict-dynamic'",
    ]);
    expect(directive(csp, 'style-src')).toEqual(["'self'", "'nonce-bm9uY2U='"]);
    expect(directive(csp, 'img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
      'https://api.example.com',
    ]);
    expect(directive(csp, 'font-src')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'none'"]);
    expect(directive(csp, 'form-action')).toEqual(["'self'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(csp.split('; ')).toContain('upgrade-insecure-requests');
  });

  it('connect-src chỉ gồm self + origin API (https, wss) — không wildcard, không path', () => {
    expect(directive(csp, 'connect-src')).toEqual([
      "'self'",
      'https://api.example.com',
      'wss://api.example.com',
    ]);
  });

  it('không bao giờ có unsafe-inline / unsafe-eval / wildcard ở production', () => {
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).not.toMatch(/(^|\s)(\*|https:)(\s|;|$)/);
  });
});

describe('buildCsp — development (W-CSP-3)', () => {
  const csp = buildCsp({
    ...PROD,
    apiUrl: 'http://localhost:4000/api/v1',
    wsUrl: 'http://localhost:4000',
    isDev: true,
    appEnv: 'local',
  });

  it('nới đúng phần cho HMR', () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toEqual(
      expect.arrayContaining(['ws://localhost:*', 'http://localhost:4000', 'ws://localhost:4000']),
    );
  });

  it('không có upgrade-insecure-requests (dev là http)', () => {
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
  });

  it('vẫn không có unsafe-inline', () => {
    expect(csp).not.toMatch(/unsafe-inline/);
  });
});

describe('buildSecurityHeaders (W-CSP-4)', () => {
  it('production có đủ header + HSTS 1 năm', () => {
    expect(buildSecurityHeaders(PROD)).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    });
  });

  it('development không có HSTS', () => {
    expect(buildSecurityHeaders({ ...PROD, isDev: true, appEnv: 'local' })).not.toHaveProperty(
      'Strict-Transport-Security',
    );
  });
});

describe('ép HTTPS theo APP_ENV, không theo NODE_ENV (ADR-101)', () => {
  it.each([
    ['local', false],
    ['test', false],
    ['staging', true],
    ['production', true],
  ] as const)('APP_ENV=%s ⇒ HSTS + upgrade-insecure-requests: %s', (appEnv, expected) => {
    // isDev=false: build production (next start) — vd E2E Docker chạy http với APP_ENV=test.
    const input = { ...PROD, appEnv, isDev: false };
    expect(enforcesHttps(appEnv)).toBe(expected);
    expect('Strict-Transport-Security' in buildSecurityHeaders(input)).toBe(expected);
    expect(buildCsp(input).includes('upgrade-insecure-requests')).toBe(expected);
  });

  it('build production với APP_ENV=test vẫn KHÔNG nới unsafe-eval (chỉ NODE_ENV=development mới nới)', () => {
    expect(buildCsp({ ...PROD, appEnv: 'test' })).not.toMatch(/unsafe-eval|unsafe-inline/);
  });
});
