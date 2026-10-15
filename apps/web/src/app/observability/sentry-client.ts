import * as Sentry from '@sentry/nextjs';

import {
  DATA_COLLECTION,
  SENTRY_TUNNEL_PATH,
  sanitizeWebEvent,
  sanitizeWebTransaction,
} from './sentry-shared';

/** Tên thẻ `<meta>` root layout (server) render — đọc ĐỒNG BỘ trước hydrate, không cần script nonce. */
export const SENTRY_META = {
  dsn: 'tf-sentry-dsn',
  environment: 'tf-sentry-environment',
  release: 'tf-sentry-release',
} as const;

export interface ClientSentryConfig {
  dsn: string;
  environment: string;
  release?: string;
}

/** Đọc cấu hình Sentry từ `<meta>`; không có DSN ⇒ `null` (Sentry tắt). */
export function readSentryMeta(doc: Pick<Document, 'querySelector'>): ClientSentryConfig | null {
  const read = (name: string) =>
    doc.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content.trim() || undefined;
  const dsn = read(SENTRY_META.dsn);
  if (!dsn) return null;
  const release = read(SENTRY_META.release);
  return {
    dsn,
    environment: read(SENTRY_META.environment) ?? 'production',
    ...(release ? { release } : {}),
  };
}

/**
 * Khởi tạo Sentry phía trình duyệt (T-035 mục 2) — gọi từ instrumentation-client.ts, TRƯỚC hydrate.
 * Event đi qua tunnel cùng origin (`/monitoring`) ⇒ không nới CSP. Không replay, không trace mặc định.
 */
export function initClientSentry(
  doc: Pick<Document, 'querySelector'> = document,
  /** Chỉ test: bắt envelope thay vì gửi qua tunnel. */
  transport?: NonNullable<Parameters<typeof Sentry.init>[0]>['transport'],
): boolean {
  const config = readSentryMeta(doc);
  if (!config) return false;
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    tunnel: SENTRY_TUNNEL_PATH,
    // Chỉ gửi lỗi: tắt session tracking (tunnel cũng chỉ chuyển tiếp item `event` — review B L1).
    integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserSession'),
    dataCollection: DATA_COLLECTION,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeWebEvent,
    beforeSendTransaction: sanitizeWebTransaction,
    ...(transport ? { transport } : {}),
  });
  return true;
}
