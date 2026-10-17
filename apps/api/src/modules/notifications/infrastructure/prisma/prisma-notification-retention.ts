import type { DbProvider } from './prisma-notification.store';

/**
 * Bước dọn của job retention (T-043, data-retention.md §4) cho `notifications` — gọi TRONG transaction
 * lô của job. Tối đa `limit` dòng mỗi lần, cũ nhất trước, `SKIP LOCKED`.
 */
export class PrismaNotificationRetention {
  constructor(private readonly db: DbProvider) {}

  /** D6: thông báo có `created_at < cutoff` (đã đọc hay chưa). */
  deleteNotifications(cutoff: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications
         WHERE created_at < ${cutoff}
         ORDER BY created_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )`;
  }
}
