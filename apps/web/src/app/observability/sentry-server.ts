import * as Sentry from '@sentry/nextjs';

import { readSentryConfig } from '@/app/config/server-env';

import { DATA_COLLECTION, sanitizeWebEvent, sanitizeWebTransaction } from './sentry-shared';

/**
 * Sentry phía server của Next (route handler, server component) — T-035 mục 2. Cùng allow-list với
 * client; không DSN ⇒ không khởi tạo. Không trace (tracesSampleRate 0) — API đã có trace riêng.
 */
export function initServerSentry(): boolean {
  const config = readSentryConfig();
  if (!config.dsn) return false;
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    dataCollection: DATA_COLLECTION,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: sanitizeWebEvent,
    beforeSendTransaction: sanitizeWebTransaction,
  });
  return true;
}
