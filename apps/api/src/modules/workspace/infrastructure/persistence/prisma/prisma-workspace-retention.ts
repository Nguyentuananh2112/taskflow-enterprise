import type { DbProvider } from './db';

/**
 * Bước dọn của job retention (T-043, data-retention.md §4) cho bảng của Workspace — gọi TRONG
 * transaction lô của job. Tối đa `limit` dòng mỗi lần, cũ nhất trước, `SKIP LOCKED`.
 */
export class PrismaWorkspaceRetention {
  constructor(private readonly db: DbProvider) {}

  /** D5: nhiệm kỳ đã kết thúc có `left_at < cutoff` (cùng ngưỡng với lượt chấm — R30). */
  deleteDepartures(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM workspace_member_departures WHERE id IN (
        SELECT id FROM workspace_member_departures
         WHERE left_at < ${cutoff}
         ORDER BY left_at
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
