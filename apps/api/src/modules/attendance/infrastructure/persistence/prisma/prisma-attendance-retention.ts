import type { DbProvider } from './db';

/**
 * Bước dọn của job retention (T-043, data-retention.md §4) cho `attendance_events` + `attendance_correction_requests`
 * (Mốc 5, D9) — gọi TRONG
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

  /**
   * D2: xóa lượt chấm theo NGÀY CÔNG `work_date < cutoffDate` (`YYYY-MM-DD`) — luôn xóa trọn một ngày:
   * OUT sau nửa đêm (trước giờ chốt) thuộc ngày công hôm trước; cắt theo `occurred_at` sẽ để lại OUT mồ
   * côi làm ngày đó hiện sai (review A).
   */
  deleteEvents(cutoffDate: string, limit: number): Promise<number> {
    // Lượt còn được đơn bổ sung tham chiếu (đơn bị SKIP LOCKED ở bước D9) ⇒ để lượt sau — FK NO ACTION không vỡ lô.
    return this.db().$executeRaw`
      DELETE FROM attendance_events WHERE id IN (
        SELECT e.id FROM attendance_events e
         WHERE e.work_date < ${cutoffDate}::date
           AND NOT EXISTS (
             SELECT 1 FROM attendance_correction_requests c WHERE c.created_event_id = e.id)
         ORDER BY e.work_date
         LIMIT ${limit}
         FOR UPDATE OF e SKIP LOCKED
      )`;
  }

  /**
   * D9 (Mốc 5, ADR-129): đơn bổ sung giờ theo NGÀY CÔNG `work_date < cutoffDate` — cùng mốc D2, chạy TRƯỚC D2 (đơn
   * APPROVED trỏ tới lượt ADJUSTMENT cùng ngày qua `created_event_id`).
   */
  deleteCorrections(cutoffDate: string, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM attendance_correction_requests WHERE id IN (
        SELECT id FROM attendance_correction_requests
         WHERE work_date < ${cutoffDate}::date
         ORDER BY work_date
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }

  /**
   * D9': lý do của nhân viên + ghi chú của HR (có thể nhắc sức khỏe — B-H2) ⇒ NULL khi `work_date < cutoffDate`
   * (mốc D3), TRỪ đơn PENDING (CHECK: PENDING phải có lý do; HR vẫn cần đọc để quyết).
   */
  scrubCorrectionReasons(cutoffDate: string, limit: number): Promise<number> {
    return this.db().$executeRaw`
      UPDATE attendance_correction_requests SET reason = NULL, decision_note = NULL WHERE id IN (
        SELECT id FROM attendance_correction_requests
         WHERE work_date < ${cutoffDate}::date AND status <> 'PENDING'
           AND (reason IS NOT NULL OR decision_note IS NOT NULL)
         ORDER BY work_date
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
