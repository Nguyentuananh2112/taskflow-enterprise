import type { IClock } from '../../../../core/domain';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IWorkspacePurger } from '../ports/collaborators.port';
import type { IWorkspaceRepository } from '../ports/repositories.port';

export const DEFAULT_PURGE_BATCH = 50;

/**
 * Job purge (ADR-095): composition root gọi mỗi giờ. Mỗi workspace một transaction riêng
 * (purger tự lấy `pg_try_advisory_xact_lock` + kiểm lại `purge_at` — chống race với restore và
 * với instance khác). Idempotent: chạy lại sau lỗi giữa chừng là an toàn.
 */
export class PurgeDeletedWorkspacesJob {
  constructor(
    private readonly d: {
      workspaces: IWorkspaceRepository;
      purger: IWorkspacePurger;
      uow: IUnitOfWork;
      clock: IClock;
      logger: ILogger;
    },
  ) {}

  async execute(input: { batchSize?: number } = {}): Promise<{ purged: number; skipped: number }> {
    const now = this.d.clock.now();
    const ids = await this.d.workspaces.listPurgeable(now, input.batchSize ?? DEFAULT_PURGE_BATCH);
    let purged = 0;
    let skipped = 0;
    for (const workspaceId of ids) {
      const done = await this.d.uow.run(() => this.d.purger.purge(workspaceId, now));
      if (done) {
        purged += 1;
        this.d.logger.info({ workspaceId }, 'workspace.purged');
      } else {
        skipped += 1;
      }
    }
    return { purged, skipped };
  }
}
