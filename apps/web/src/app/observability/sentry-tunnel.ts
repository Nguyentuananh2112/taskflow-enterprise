// Tunnel `/monitoring` (T-035 mục 2): trình duyệt gửi envelope về CÙNG origin (không nới CSP); server
// chuyển tiếp tới ingest của Sentry. KHÔNG phải proxy mở: chỉ nhận envelope có DSN trùng DSN đã cấu
// hình, giới hạn kích thước, chỉ gọi tới host/project của chính DSN đó.

/** Đủ cho một event lỗi (không có replay / attachment). */
export const MAX_ENVELOPE_BYTES = 200_000;

export type TunnelDecision =
  { ok: true; url: string } | { ok: false; status: 400 | 403 | 404 | 413 };

/** URL ingest envelope của một DSN: `https://<host>/api/<projectId>/envelope/`. */
export function ingestUrlOf(dsn: string): string {
  const url = new URL(dsn);
  const projectId =
    url.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .pop() ?? '';
  return `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
}

/** Quyết định chuyển tiếp hay từ chối — hàm thuần để test. */
export function decideTunnel(configuredDsn: string | undefined, envelope: string): TunnelDecision {
  if (!configuredDsn) return { ok: false, status: 404 };
  if (new TextEncoder().encode(envelope).length > MAX_ENVELOPE_BYTES) {
    return { ok: false, status: 413 };
  }
  const firstLine = envelope.slice(
    0,
    envelope.indexOf('\n') === -1 ? undefined : envelope.indexOf('\n'),
  );
  let header: { dsn?: unknown };
  try {
    header = JSON.parse(firstLine) as { dsn?: unknown };
  } catch {
    return { ok: false, status: 400 };
  }
  if (header.dsn !== configuredDsn) return { ok: false, status: 403 };
  return { ok: true, url: ingestUrlOf(configuredDsn) };
}
