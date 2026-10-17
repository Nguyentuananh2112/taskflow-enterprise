import type { DbProvider } from './prisma-company';

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
         ORDER BY created_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /** D7: HrAuditLog có `created_at < cutoff`. */
  deleteHrAuditLogs(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM hr_audit_logs WHERE id IN (
        SELECT id FROM hr_audit_logs
         WHERE created_at < ${cutoff}
         ORDER BY created_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
