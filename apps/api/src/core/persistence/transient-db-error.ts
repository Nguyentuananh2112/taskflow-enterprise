/**
 * Lỗi DB TẠM THỜI — chạy lại cả transaction là có thể thành công (review B T-033 F3/F5):
 * - `40P01` deadlock_detected (hai rebalance chéo cột cùng project);
 * - `40001` serialization_failure;
 * - `55P03` lock_not_available — `lock_timeout` hết khi chờ khóa (khóa cột advisory, khóa dòng).
 *
 * Đọc SQLSTATE theo cấu trúc lỗi (không phụ thuộc lớp Prisma): `meta.driverAdapterError.cause
 * .originalCode` (Prisma 7 + adapter-pg), `code` của lỗi pg, hoặc trong chuỗi `cause`.
 */
export type TransientDbCode = '40P01' | '40001' | '55P03';

const TRANSIENT = new Set<string>(['40P01', '40001', '55P03']);
const SQLSTATE = /^[0-9A-Z]{5}$/;

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null;

function sqlStateOf(err: Bag): string | undefined {
  const meta = err['meta'];
  if (isBag(meta)) {
    const adapter = meta['driverAdapterError'];
    const cause = isBag(adapter) ? adapter['cause'] : undefined;
    const original = isBag(cause) ? cause['originalCode'] : undefined;
    if (typeof original === 'string') return original;
  }
  const code = err['code'];
  return typeof code === 'string' && SQLSTATE.test(code) ? code : undefined;
}

export function transientDbErrorCode(err: unknown): TransientDbCode | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && isBag(current); depth += 1) {
    const state = sqlStateOf(current);
    if (state !== undefined && TRANSIENT.has(state)) return state as TransientDbCode;
    current = current['cause'];
  }
  return null;
}
