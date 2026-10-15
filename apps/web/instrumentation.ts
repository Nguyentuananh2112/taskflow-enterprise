import * as Sentry from '@sentry/nextjs';

// Next gọi `register` một lần khi server khởi động (T-035): Sentry phía server, chỉ runtime Node
// (proxy.ts / edge không cần). Không DSN ⇒ không làm gì.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initServerSentry } = await import('./src/app/observability/sentry-server');
  initServerSentry();
}

// Lỗi của server component / route handler ⇒ Sentry (event đi qua beforeSend allow-list).
export const onRequestError = Sentry.captureRequestError;
