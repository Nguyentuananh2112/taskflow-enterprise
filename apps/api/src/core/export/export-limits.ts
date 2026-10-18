/**
 * Trần + nhịp đọc của báo cáo .xlsx (ADR-130, T-055). Mặc định = thiết kế (hr-extended §4: 1 000 người, 20 000 dòng
 * phép). Bốn env `EXPORT_*` CHỈ APP_ENV=test (config/env.ts từ chối khởi động ở nơi khác — như ADR-141): F hạ trần để
 * dựng ca EXPORT_TOO_LARGE nhỏ (XL-05), chèn trễ giữa các lô để giữ export "đang chạy" (SEC-HR-54 429 thứ 3, XL-07
 * REPEATABLE READ).
 */
export interface ExportLimits {
  /** Báo cáo chấm công tháng: vượt ⇒ 422 `EXPORT_TOO_LARGE` TRƯỚC header, không audit. */
  maxEmployees: number;
  /** Báo cáo phép năm: số đơn tối đa. */
  maxLeaveRows: number;
  /** Số dòng đọc DB mỗi lô (keyset) trong transaction REPEATABLE READ READ ONLY. */
  batchSize: number;
  /** Trễ giữa hai lô đọc (ms) — 0 ngoài test. */
  batchDelayMs: number;
}

export const DEFAULT_EXPORT_LIMITS: Readonly<ExportLimits> = Object.freeze({
  maxEmployees: 1_000,
  maxLeaveRows: 20_000,
  batchSize: 500,
  batchDelayMs: 0,
});

export function exportLimitsFromEnv(env: {
  EXPORT_MAX_EMPLOYEES?: number | undefined;
  EXPORT_MAX_LEAVE_ROWS?: number | undefined;
  EXPORT_BATCH_SIZE?: number | undefined;
  EXPORT_BATCH_DELAY_MS?: number | undefined;
}): ExportLimits {
  const d = DEFAULT_EXPORT_LIMITS;
  return {
    maxEmployees: env.EXPORT_MAX_EMPLOYEES ?? d.maxEmployees,
    maxLeaveRows: env.EXPORT_MAX_LEAVE_ROWS ?? d.maxLeaveRows,
    batchSize: env.EXPORT_BATCH_SIZE ?? d.batchSize,
    batchDelayMs: env.EXPORT_BATCH_DELAY_MS ?? d.batchDelayMs,
  };
}
