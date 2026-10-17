import type { DbProvider } from './db';

/**
 * Bước dọn của job retention (T-043, data-retention.md §4) cho bảng `attendance_events` — gọi TRONG
 * transaction lô của job (khóa advisory do job lấy). Mỗi lần tối đa `limit` dòng, cũ nhất trước;
 * `SKIP LOCKED` ⇒ không chờ dòng đang bị lệnh khác khóa (lô sau làm nốt). Trả số dòng đã đổi.
 */
export class PrismaAttendanceRetention {
  constructor(private readonly db: DbProvider) {}

  /** D1: IP / User-Agent của lượt chấm có `occurred_at < cutoff` ⇒ NULL (giữ lượt chấm). */
  scrubClientInfo(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      UPDATE attendance_events SET ip = NULL, user_agent = NULL WHERE id IN (
        SELECT id FROM attendance_events
         WHERE occurred_at < ${cutoff} AND (ip IS NOT NULL OR user_agent IS NOT NULL)
         ORDER BY occurred_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /** D2: xóa lượt chấm có `occurred_at < cutoff`. */
  deleteEvents(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM attendance_events WHERE id IN (
        SELECT id FROM attendance_events
         WHERE occurred_at < ${cutoff}
         ORDER BY occurred_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
