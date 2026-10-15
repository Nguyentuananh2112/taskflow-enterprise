import type { IClock } from '../../../../core/domain';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { IWorkspacePurger } from '../ports/collaborators.port';
import type { IWorkspaceRepository } from '../ports/repositories.port';
import { PurgeRunStopped } from '../purge-errors';

export const DEFAULT_PURGE_BATCH = 50;

/**
 * Job purge (ADR-095): composition root gọi mỗi giờ. Mỗi workspace một transaction riêng
 * (purger tự lấy `pg_try_advisory_xact_lock` + kiểm lại `purge_at` — chống race với restore và
 * với instance khác). Idempotent: chạy lại sau lỗi giữa chừng là an toàn.
 *
 * Một workspace lỗi KHÔNG dừng cả lô (G1 F4 — trước đây workspace lỗi có `purge_at` cũ nhất đứng
 * đầu mọi lượt ⇒ không workspace nào được purge nữa): log `workspace.purge_failed`, đếm `failed`,
 * đi tiếp; lượt sau tự thử lại. Riêng `PurgeRunStopped` (instance khác đang chạy) dừng cả lượt.
 *
 * `signal` hủy (graceful shutdown — G1 F7) ⇒ dừng TRƯỚC workspace kế tiếp; workspace đang purge
 * chạy hết transaction của nó (không cắt giữa chừng). Phần còn lại để lượt sau — idempotent.
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

  async execute(
    input: { batchSize?: number; signal?: AbortSignal } = {},
  ): Promise<{ purged: number; skipped: number; failed: number }> {
    const now = this.d.clock.now();
    const ids = await this.d.workspaces.listPurgeable(now, input.batchSize ?? DEFAULT_PURGE_BATCH);
    let purged = 0;
    let skipped = 0;
    let failed = 0;
    for (const workspaceId of ids) {
      if (input.signal?.aborted) break;
      let done: boolean;
      try {
        done = await this.d.uow.run(() => this.d.purger.purge(workspaceId, now));
      } catch (err) {
        if (err instanceof PurgeRunStopped) throw err;
        failed += 1;
        // Serializer allow-list của logger (T-031) chỉ giữ tên / mã lỗi an toàn — không dòng dữ liệu.
        this.d.logger.warn({ workspaceId, err }, 'workspace.purge_failed');
        continue;
      }
      if (done) {
        purged += 1;
        this.d.logger.info({ workspaceId }, 'workspace.purged');
      } else {
        skipped += 1;
      }
    }
    return { purged, skipped, failed };
  }
}
