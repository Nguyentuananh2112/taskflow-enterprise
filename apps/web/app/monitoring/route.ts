import { readSentryConfig } from '@/app/config/server-env';
import { MAX_ENVELOPE_BYTES, decideTunnel } from '@/app/observability/sentry-tunnel';

// Tunnel Sentry cùng origin (T-035): trình duyệt gửi envelope về đây ⇒ CSP không phải mở `connect-src`
// cho ingest của Sentry. Không cấu hình DSN ⇒ 404 (không thành endpoint mở).
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const { dsn } = readSentryConfig();
  if (!dsn) return new Response(null, { status: 404 });
  if (Number(request.headers.get('content-length') ?? '0') > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 });
  }
  const envelope = await request.text().catch(() => '');
  const decision = decideTunnel(dsn, envelope);
  if (!decision.ok) return new Response(null, { status: decision.status });
  try {
    // Ngoại lệ có chủ đích của luật "gọi mạng chỉ qua shared/api": đây là route SERVER chuyển tiếp
    // envelope tới ingest Sentry (không phải gọi API của app). URL chỉ từ DSN đã cấu hình.
    // eslint-disable-next-line no-restricted-globals
    const upstream = await fetch(decision.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: envelope,
      signal: AbortSignal.timeout(5_000),
    });
    return new Response(null, { status: upstream.ok ? 200 : 502 });
  } catch {
    return new Response(null, { status: 502 });
  }
}
