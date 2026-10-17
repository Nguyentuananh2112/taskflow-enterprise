import type { DbProvider } from './prisma-company';

/**
 * Audit lương (`PAYROLL_*`, payroll.md §3, RD-11) NẰM NGOÀI D7 / D7' — hạn lưu chứng từ lương riêng (chốt cùng R27).
 * `\_` thoát dấu gạch dưới của LIKE.
 */
const PAYROLL_AUDIT_PATTERN = 'PAYROLL\\_%';

/**
 * Bước dọn của job retention (T-043, data-retention.md §4) cho bảng của module company — gọi TRONG
 * transaction lô của job. Tối đa `limit` dòng mỗi lần, cũ nhất trước, `SKIP LOCKED`.
 */
export class PrismaCompanyRetention {
  constructor(private readonly db: DbProvider) {}

  /**
   * D5 (Mốc 3.5): nhiệm kỳ đã đóng có `last_day < cutoffDate` (`YYYY-MM-DD`, cùng mốc ngày với attendance —
   * company-level.md §R27); so theo NGÀY, không theo `left_at` (giờ chạy job hoàn tất).
   */
  deleteDepartures(cutoffDate: string, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM company_member_departures WHERE id IN (
        SELECT id FROM company_member_departures
         WHERE last_day < ${cutoffDate}::date
         ORDER BY last_day
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /**
   * D7': bỏ khóa `note` (chữ tự do của người quản trị — có thể nhắc sức khỏe) khỏi `before` / `after` của
   * HrAuditLog có `created_at < cutoff` (mốc lý do nghỉ — TL chốt). Dòng audit vẫn giữ tới mốc D7 với hành
   * động / ai / khi nào / giá trị trước–sau.
   */
  scrubHrAuditNotes(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      UPDATE hr_audit_logs SET "before" = "before" - 'note', "after" = "after" - 'note' WHERE id IN (
        SELECT id FROM hr_audit_logs
         WHERE created_at < ${cutoff} AND ("before" ? 'note' OR "after" ? 'note')
           AND action NOT LIKE ${PAYROLL_AUDIT_PATTERN}
         ORDER BY created_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /** D7: HrAuditLog có `created_at < cutoff` — trừ audit lương `PAYROLL_*`. */
  deleteHrAuditLogs(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM hr_audit_logs WHERE id IN (
        SELECT id FROM hr_audit_logs
         WHERE created_at < ${cutoff} AND action NOT LIKE ${PAYROLL_AUDIT_PATTERN}
         ORDER BY created_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
