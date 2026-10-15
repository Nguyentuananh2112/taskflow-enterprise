import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { readPublicRuntimeConfig, readSentryConfig } from '@/app/config/server-env';
import { SENTRY_META } from '@/app/observability/sentry-meta';
import { AppProviders } from '@/app/providers';
import { THEME_BOOT_SCRIPT } from '@/shared/lib/theme-boot';

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
    // suppressHydrationWarning: script theme đặt `data-theme` lên <html> TRƯỚC khi React hydrate.
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/*
          Theme TRƯỚC khi paint (frontend.md §6.1): script inline mang nonce CSP của request (không nới CSP),
          nội dung là text (không dangerouslySetInnerHTML). next/script beforeInteractive KHÔNG dùng được:
          App Router chỉ xếp vào hàng `__next_s`, chạy sau khi tải JS ⇒ vẫn nháy màu.
          suppressHydrationWarning: trình duyệt ẩn giá trị thuộc tính nonce sau khi parse.
        */}
        <script nonce={nonce} suppressHydrationWarning>
          {THEME_BOOT_SCRIPT}
        </script>
        {/* T-035: cấu hình Sentry trình duyệt — instrumentation-client đọc đồng bộ trước hydrate. */}
        {sentry.dsn ? (
          <>
            <meta name={SENTRY_META.dsn} content={sentry.dsn} />
            <meta name={SENTRY_META.environment} content={sentry.environment} />
            {sentry.release ? <meta name={SENTRY_META.release} content={sentry.release} /> : null}
          </>
        ) : null}
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        <AppProviders config={config} nonce={nonce}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
