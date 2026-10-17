import type { Prisma } from '../generated/prisma/client';
import { PrismaRefreshTokenPurger } from '../modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.purger';
import { ExclusivePurgeRun } from '../modules/workspace/infrastructure/jobs/exclusive-purge-run';
import { PrismaWorkspacePurger } from '../modules/workspace/infrastructure/persistence/prisma/prisma-workspace.purger';
import { PrismaAttendanceRetention } from '../modules/attendance/infrastructure/persistence/prisma/prisma-attendance-retention';
import { PrismaLeaveRetention } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave-retention';
import { PrismaNotificationRetention } from '../modules/notifications/infrastructure/prisma/prisma-notification-retention';
import { PrismaWorkspaceRetention } from '../modules/workspace/infrastructure/persistence/prisma/prisma-workspace-retention';

/** Bước dọn của từng module (chỉ Prisma) — khớp cấu trúc các lớp `Prisma*Retention`. */
export interface RetentionStores {
  attendance: {
    scrubClientInfo(cutoff: Date, limit: number): Promise<number>;
    deleteEvents(cutoffDate: string, limit: number): Promise<number>;
  };
  leave: {
    scrubReasons(cutoffDate: string, limit: number): Promise<number>;
    deleteRequestsBeforeYear(year: number, limit: number): Promise<number>;
    deleteBalancesBeforeYear(year: number, limit: number): Promise<number>;
  };
  workspace: {
    deleteDepartures(cutoff: Date, limit: number): Promise<number>;
    deleteHrAuditLogs(cutoff: Date, limit: number): Promise<number>;
    scrubHrAuditNotes(cutoff: Date, limit: number): Promise<number>;
  };
  notifications: { deleteNotifications(cutoff: Date, limit: number): Promise<number> };
  /** Câu ĐẦU của mỗi transaction lô; `false` ⇒ instance khác đang chạy. */
  tryLock(): Promise<boolean>;
}

export const RETENTION_LOCK_KEY = 'taskflow:retention';

/** `pg_try_advisory_xact_lock` — tự nhả khi commit / rollback, an toàn với pool (mẫu ADR-095). */
export function prismaRetentionLock(db: () => Prisma.TransactionClient): () => Promise<boolean> {
  return async () => {
    const [row] = await db().$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${RETENTION_LOCK_KEY}, 0)) AS locked`;
    return row?.locked === true;
  };
}

/** Bước dọn Prisma của mỗi module chủ bảng (T-043; ranh giới module như T-040b L2) + khóa của job. */
export function prismaRetentionStores(db: () => Prisma.TransactionClient): RetentionStores {
  return {
    attendance: new PrismaAttendanceRetention(db),
    leave: new PrismaLeaveRetention(db),
    workspace: new PrismaWorkspaceRetention(db),
    notifications: new PrismaNotificationRetention(db),
    tryLock: prismaRetentionLock(db),
  };
}

/** Purger của mọi job bảo trì (T-033, G2 S2, T-043) — chỉ có ở Prisma; bộ nhớ không purge. */
export function prismaMaintenance(db: () => Prisma.TransactionClient) {
  return {
    workspacePurger: new ExclusivePurgeRun(db, new PrismaWorkspacePurger(db)),
    refreshTokenPurger: new PrismaRefreshTokenPurger(db),
    retention: prismaRetentionStores(db),
  };
}
