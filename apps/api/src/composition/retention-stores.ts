import type { Prisma } from '../generated/prisma/client';
import { PrismaRefreshTokenPurger } from '../modules/auth/infrastructure/persistence/prisma/prisma-refresh-token.purger';
import { ExclusivePurgeRun } from '../modules/workspace/infrastructure/jobs/exclusive-purge-run';
import { PrismaWorkspacePurger } from '../modules/workspace/infrastructure/persistence/prisma/prisma-workspace.purger';
import { PrismaAttendanceRetention } from '../modules/attendance/infrastructure/persistence/prisma/prisma-attendance-retention';
import { PrismaLeaveRetention } from '../modules/leave/infrastructure/persistence/prisma/prisma-leave-retention';
import { PrismaNotificationRetention } from '../modules/notifications/infrastructure/prisma/prisma-notification-retention';
import { PrismaCompanyRetention } from '../modules/company/infrastructure/prisma/prisma-company-retention';
import { PrismaEmployeeProfileRetention } from '../modules/hr-profile/infrastructure/prisma/prisma-employee-profiles';
import { PrismaPrivacyStore } from '../modules/auth/infrastructure/persistence/prisma/prisma-privacy.store';

/** Bước dọn của từng module (chỉ Prisma) — khớp cấu trúc các lớp `Prisma*Retention`. */
export interface RetentionStores {
  attendance: {
    scrubClientInfo(cutoff: Date, limit: number): Promise<number>;
    deleteEvents(cutoffDate: string, limit: number): Promise<number>;
    /** D9 / D9' (Mốc 5, T-055): đơn bổ sung giờ. */
    deleteCorrections(cutoffDate: string, limit: number): Promise<number>;
    scrubCorrectionReasons(cutoffDate: string, limit: number): Promise<number>;
  };
  leave: {
    scrubReasons(cutoffDate: string, limit: number): Promise<number>;
    deleteRequestsBeforeYear(year: number, limit: number): Promise<number>;
    deleteBalancesBeforeYear(year: number, limit: number): Promise<number>;
  };
  company: {
    deleteDepartures(cutoffDate: string, limit: number): Promise<number>;
    deleteHrAuditLogs(cutoff: Date, limit: number): Promise<number>;
    scrubHrAuditNotes(cutoff: Date, limit: number): Promise<number>;
  };
  notifications: { deleteNotifications(cutoff: Date, limit: number): Promise<number> };
  /** D8 (Mốc 5, T-054): hồ sơ của người đã nghỉ quá mốc D5. */
  hrProfile: { deleteProfiles(cutoffDate: string, limit: number): Promise<number> };
  /** D16 (T-075): sự kiện bằng chứng đồng ý — 5 năm kể từ `at`. */
  privacy: { purgeEventsBefore(cutoff: Date, limit: number): Promise<number> };
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
    company: new PrismaCompanyRetention(db),
    notifications: new PrismaNotificationRetention(db),
    hrProfile: new PrismaEmployeeProfileRetention(db),
    privacy: new PrismaPrivacyStore(db),
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
