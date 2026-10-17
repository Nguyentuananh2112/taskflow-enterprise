import type { DbProvider } from './db';

/**
 * Bước dọn của job retention (T-043, data-retention.md §4) cho `leave_requests` / `leave_balances` —
 * gọi TRONG transaction lô của job. Tối đa `limit` dòng mỗi lần, cũ nhất trước, `SKIP LOCKED`.
 * Không tăng `version`: dọn dữ liệu không phải thay đổi nghiệp vụ của đơn.
 */
export class PrismaLeaveRetention {
  constructor(private readonly db: DbProvider) {}

  /**
   * D3: lý do nghỉ (có thể là dữ liệu sức khỏe) + ghi chú quyết định của HR (cũng có thể nhắc sức khỏe —
   * góp ý D) của đơn có `end_date < cutoffDate` ⇒ NULL. Đơn PENDING giữ lý do (HR còn cần để duyệt).
   * `save` của repository không ghi `reason` ⇒ không lệnh nào ghi đè lại dòng vừa scrub. `cutoffDate` =
   * `YYYY-MM-DD`.
   */
  scrubReasons(cutoffDate: string, limit: number): Promise<number> {
    return this.db().$executeRaw`
      UPDATE leave_requests SET reason = NULL, decision_note = NULL WHERE id IN (
        SELECT id FROM leave_requests
         WHERE end_date < ${cutoffDate}::date AND status <> 'PENDING'
           AND (reason IS NOT NULL OR decision_note IS NOT NULL)
         ORDER BY end_date
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /**
   * D4: xóa đơn của các năm `< year` — theo CẢ năm vì số ngày đã dùng tính lại từ đơn (D-H3a); đơn
   * không kéo qua hai năm (`LEAVE_SPANS_YEARS`) nên `start_date` quyết định năm.
   */
  deleteRequestsBeforeYear(year: number, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM leave_requests WHERE id IN (
        SELECT id FROM leave_requests
         WHERE start_date < make_date(${year}::int, 1, 1)
         ORDER BY start_date
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /** D4: xóa số dư của các năm `< year` (bảng khóa chính (ws, user, year) — không có cột id). */
  deleteBalancesBeforeYear(year: number, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM leave_balances WHERE (workspace_id, user_id, year) IN (
        SELECT workspace_id, user_id, year FROM leave_balances
         WHERE year < ${year}::int
         ORDER BY year
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
