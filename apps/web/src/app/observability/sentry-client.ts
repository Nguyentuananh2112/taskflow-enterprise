import * as Sentry from '@sentry/nextjs';

import {
  DATA_COLLECTION,
  SENTRY_TUNNEL_PATH,
  sanitizeWebEvent,
  sanitizeWebTransaction,
} from './sentry-shared';
import { readSentryMeta } from './sentry-meta';

/** Integration mặc định của bản client bị tắt (T-035, review B/E). */
export const DISABLED_BROWSER_INTEGRATIONS = new Set([
  'BrowserSession',
  'BrowserTracing',
  'Breadcrumbs',
]);

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
    // Chỉ gửi lỗi: bỏ session (tunnel cũng chỉ chuyển tiếp item `event` — review B L1), bỏ tracing
    // (không bọc fetch/history để gắn trace) và breadcrumbs (không patch console/history/fetch).
    integrations: (defaults) => defaults.filter((i) => !DISABLED_BROWSER_INTEGRATIONS.has(i.name)),
    dataCollection: DATA_COLLECTION,
    tracesSampleRate: 0,
    // Review E: mặc định SDK gắn `sentry-trace` + `baggage` vào fetch/XHR tới 'localhost' và đường dẫn
    // tương đối — ĐỘC LẬP với sampling ⇒ preflight CORS tới API (allowedHeaders hẹp) bị từ chối và lộ
    // trace id. Không lan truyền tới đâu cả.
    tracePropagationTargets: [],
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeWebEvent,
    beforeSendTransaction: sanitizeWebTransaction,
    ...(transport ? { transport } : {}),
  });
  return true;
}
