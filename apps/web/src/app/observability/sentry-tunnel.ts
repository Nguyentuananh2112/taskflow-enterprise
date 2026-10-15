// Tunnel `/monitoring` (T-035 mục 2): trình duyệt gửi envelope về CÙNG origin (không nới CSP); server
// chuyển tiếp tới ingest của Sentry. KHÔNG phải proxy mở: chỉ nhận envelope có DSN trùng DSN đã cấu
// hình, giới hạn kích thước (đọc dạng luồng, cắt ở trần), giới hạn tần suất, chỉ chuyển tiếp item
// `event`, chỉ gọi tới host/project của chính DSN đó (review B: M1, L1).

/** Đủ cho một event lỗi (không có replay / attachment). */
export const MAX_ENVELOPE_BYTES = 200_000;

/** Hạn mức chuyển tiếp: theo IP và tổng của instance (IP giả mạo được thì trần tổng vẫn giữ). */
export const TUNNEL_LIMITS = {
  windowMs: 60_000,
  perIp: 30,
  perInstance: 300,
} as const;

/** Chỉ chuyển tiếp lỗi — session/replay/attachment/… bị bỏ (không tốn quota, không mang dữ liệu lạ). */
const FORWARDED_ITEM_TYPES = new Set(['event']);

export type TunnelDecision =
  | { ok: true; url: string }
  /** Hợp lệ nhưng không chuyển tiếp (item không phải lỗi) — trả 200 để SDK không gửi lại. */
  | { ok: false; status: 200 | 400 | 403 | 404 | 413 };

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

/**
 * Đọc body dạng luồng, dừng (hủy luồng) ngay khi vượt `maxBytes` — KHÔNG đệm toàn bộ body khi thiếu
 * Content-Length (chunked). Vượt ⇒ `null`.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

const parseJson = (line: string | undefined): Record<string, unknown> | null => {
  if (line === undefined) return null;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Quyết định chuyển tiếp hay từ chối — hàm thuần để test. */
export function decideTunnel(configuredDsn: string | undefined, envelope: string): TunnelDecision {
  if (!configuredDsn) return { ok: false, status: 404 };
  if (new TextEncoder().encode(envelope).length > MAX_ENVELOPE_BYTES) {
    return { ok: false, status: 413 };
  }
  const lines = envelope.split('\n');
  const header = parseJson(lines[0]);
  if (!header) return { ok: false, status: 400 };
  if (header['dsn'] !== configuredDsn) return { ok: false, status: 403 };
  // Envelope: header, rồi từng cặp (item header, payload JSON một dòng).
  const itemTypes: unknown[] = [];
  for (let i = 1; i < lines.length; i += 2) {
    if ((lines[i] ?? '').trim() === '') continue;
    const itemHeader = parseJson(lines[i]);
    if (!itemHeader) return { ok: false, status: 400 };
    itemTypes.push(itemHeader['type']);
  }
  if (itemTypes.length === 0) return { ok: false, status: 400 };
  if (!itemTypes.every((t) => typeof t === 'string' && FORWARDED_ITEM_TYPES.has(t))) {
    return { ok: false, status: 200 };
  }
  return { ok: true, url: ingestUrlOf(configuredDsn) };
}

/** Trên ngưỡng này mới quét dọn IP hết hạn (mỗi IP tối đa `perIp` mốc thời gian). */
const MAX_TRACKED_IPS = 10_000;

/** Đếm cửa sổ trượt trong bộ nhớ của instance (không phụ thuộc dịch vụ ngoài). */
export class TunnelRateLimiter {
  static readonly MAX_TRACKED_IPS = MAX_TRACKED_IPS;

  readonly #hits = new Map<string, number[]>();
  #global: number[] = [];

  constructor(
    private readonly limits: {
      windowMs: number;
      perIp: number;
      perInstance: number;
    } = TUNNEL_LIMITS,
  ) {}

  /** `false` ⇒ vượt hạn mức (theo IP hoặc tổng). */
  tryHit(ip: string, now: number): boolean {
    const since = now - this.limits.windowMs;
    // Dọn ở MỌI nhánh (review B): xoay IP lúc trần tổng bão hòa không được làm Map phình mãi.
    if (this.#hits.size > MAX_TRACKED_IPS) this.#sweep(since);
    this.#global = this.#global.filter((t) => t > since);
    const mine = (this.#hits.get(ip) ?? []).filter((t) => t > since);
    if (this.#global.length >= this.limits.perInstance || mine.length >= this.limits.perIp) {
      // Từ chối: KHÔNG thêm IP mới (mảng rỗng) vào Map — chỉ cập nhật IP đã có lượt trong cửa sổ.
      if (mine.length > 0) this.#hits.set(ip, mine);
      else this.#hits.delete(ip);
      return false;
    }
    mine.push(now);
    this.#global.push(now);
    this.#hits.delete(ip); // chèn lại ⇒ thứ tự Map = mới dùng gần nhất ở cuối (LRU)
    this.#hits.set(ip, mine);
    // Trần cứng: vẫn quá ngưỡng sau khi dọn ⇒ bỏ IP dùng lâu nhất (đầu Map).
    while (this.#hits.size > MAX_TRACKED_IPS) {
      const oldest = this.#hits.keys().next().value;
      if (oldest === undefined) break;
      this.#hits.delete(oldest);
    }
    return true;
  }

  /** Số IP đang theo dõi (để test kiểm việc dọn). */
  get trackedIps(): number {
    return this.#hits.size;
  }

  #sweep(since: number): void {
    for (const [key, hits] of this.#hits) {
      if (!hits.some((t) => t > since)) this.#hits.delete(key);
    }
  }
}

/**
 * IP client sau `trustProxyHops` proxy tin cậy (cùng quy tắc `TRUST_PROXY_HOPS` của API): mỗi proxy
 * GẮN THÊM vào cuối `X-Forwarded-For` ⇒ IP client là phần tử thứ `hops` tính từ cuối (1 proxy ⇒ phần
 * tử cuối; CDN + LB ⇒ áp chót). Phần client tự gửi nằm phía trước nên không giả được. Thiếu ⇒
 * `unknown` (vẫn bị trần tổng của instance chặn). IPv6 gom theo /56 như `ipKeyGenerator` của API.
 */
export function clientIpOf(headers: Headers, trustProxyHops = 1): string {
  // 0 proxy tin cậy ⇒ X-Forwarded-For do client tự đặt ⇒ không dùng (chỉ còn trần tổng của instance).
  if (trustProxyHops <= 0) return 'unknown';
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = chain[chain.length - trustProxyHops];
  return ip ? ipv6Prefix56(ip) : 'unknown';
}

/** IPv6 ⇒ tiền tố /56 (`2001:db8:aa:bb00::/56`); IPv4 (kể cả dạng ::ffff:a.b.c.d) giữ nguyên. */
export function ipv6Prefix56(ip: string): string {
  if (!ip.includes(':') || /\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [
    ...left,
    ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'),
    ...right,
  ];
  const hex = groups.map((g) => g.padStart(4, '0').toLowerCase());
  return `${hex[0]}:${hex[1]}:${hex[2]}:${(hex[3] ?? '0000').slice(0, 2)}00::/56`;
}
