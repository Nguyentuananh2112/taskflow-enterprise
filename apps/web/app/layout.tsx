import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { readPublicRuntimeConfig, readSentryConfig } from '@/app/config/server-env';
import { SENTRY_META } from '@/app/observability/sentry-client';
import { AppProviders } from '@/app/providers';

// Font Inter tự host qua @font-face trong globals.css (không next/font/google: build không phụ thuộc mạng).
import '@/app/styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'TaskFlow', template: '%s · TaskFlow' },
  description: 'Quản lý công việc theo nhóm với bảng Kanban thời gian thực.',
};

/**
 * Render ĐỘNG mỗi request (đọc headers): bắt buộc cho CSP nonce (ADR-084) và để
 * API_URL đọc lúc chạy, không bị đóng băng lúc build (ADR-074, frontend.md §3.6).
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const config = readPublicRuntimeConfig();
  const sentry = readSentryConfig();
  return (
    <html lang="vi">
      {/* T-035: cấu hình Sentry trình duyệt — instrumentation-client đọc đồng bộ trước hydrate. */}
      {sentry.dsn ? (
        <head>
          <meta name={SENTRY_META.dsn} content={sentry.dsn} />
          <meta name={SENTRY_META.environment} content={sentry.environment} />
          {sentry.release ? <meta name={SENTRY_META.release} content={sentry.release} /> : null}
        </head>
      ) : null}
      <body className="min-h-screen bg-bg text-text antialiased">
        <AppProviders config={config} nonce={nonce}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
