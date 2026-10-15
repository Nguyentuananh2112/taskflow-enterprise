// Đọc cấu hình Sentry từ <meta> — module KHÔNG import SDK: instrumentation-client import tĩnh file này
// để quyết định có nạp SDK (dynamic import) hay không (review E: SDK ~74 kB gzip không vào bundle khi
// không có DSN).

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
