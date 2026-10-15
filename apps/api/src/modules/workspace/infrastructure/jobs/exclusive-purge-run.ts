import type { IWorkspacePurger } from '../../application/ports/collaborators.port';
import type { DbProvider } from '../persistence/prisma/db';

/**
 * Khóa advisory của "một lô purge" (ADR-095, data-and-api §1.7): hằng số chung mọi instance.
 * `hashtextextended` của chuỗi cố định — không đụng khóa theo ws của purger (`taskflow:purge:<id>`).
 */
export const PURGE_RUN_LOCK_KEY = 'taskflow:purge-run';

/** Instance khác đang chạy một lô purge ⇒ dừng lượt này (không phải lỗi). */
export class PurgeRunBusyError extends Error {
  constructor() {
    super('Instance khác đang chạy purge — bỏ lượt này.');
    this.name = 'PurgeRunBusyError';
  }
}

/**
 * Decorator của `IWorkspacePurger` (T-033). Câu ĐẦU TIÊN của mỗi transaction lô là
 * `pg_try_advisory_xact_lock(<hằng số>)` — khóa tự nhả khi commit/rollback, an toàn với pool
 * (không dùng khóa mức session — ADR-095). Không lấy được ⇒ `PurgeRunBusyError` ⇒ scheduler dừng
 * lượt. Hai instance có thể xen kẽ lô giữa các transaction: an toàn vì purger tự kiểm lại `purge_at`
 * và idempotent.
 */
export class ExclusivePurgeRun implements IWorkspacePurger {
  constructor(
    private readonly db: DbProvider,
    private readonly inner: IWorkspacePurger,
  ) {}

  async purge(workspaceId: string, now: Date): Promise<boolean> {
    const [row] = await this.db().$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${PURGE_RUN_LOCK_KEY}, 0)) AS locked`;
    if (!row?.locked) throw new PurgeRunBusyError();
    return this.inner.purge(workspaceId, now);
  }
}
