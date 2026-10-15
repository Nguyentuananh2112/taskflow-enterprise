import type { IWorkspacePurger } from '../../../application/ports/collaborators.port';
import type { DbProvider } from './db';

/** Lô xóa (data-and-api 1.7): giới hạn kích thước mỗi câu DELETE. */
export const PURGE_BATCH_SIZE = 5000;

/**
 * Xóa cứng một workspace hết ân hạn (ADR-095). Chạy TRONG transaction do job mở (`uow.run`):
 * 1) `pg_try_advisory_xact_lock` theo workspace — instance khác đang purge ws này ⇒ bỏ qua;
 * 2) khóa dòng workspace + KIỂM LẠI `purge_at <= now` (có thể vừa được khôi phục — WSR-05);
 * 3) xóa audit rồi task theo project (dùng index project_id), theo lô; 4) xóa workspace (cascade
 *    membership/project). Idempotent: chạy lại sau lỗi giữa chừng là an toàn.
 */
export class PrismaWorkspacePurger implements IWorkspacePurger {
  constructor(private readonly db: DbProvider) {}

  async purge(workspaceId: string, now: Date): Promise<boolean> {
    const db = this.db();
    const [lock] = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended('taskflow:purge:' || ${workspaceId}, 0)) AS locked`;
    if (!lock?.locked) return false;

    const [ws] = await db.$queryRaw<{ purge_at: Date | null }[]>`
      SELECT purge_at FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
    if (!ws?.purge_at || ws.purge_at.getTime() > now.getTime()) return false;

    const projects = await db.project.findMany({ where: { workspaceId }, select: { id: true } });
    for (const { id: projectId } of projects) {
      await this.#deleteInBatches(
        () => db.$executeRaw`
          DELETE FROM task_audit_logs WHERE id IN (
            SELECT id FROM task_audit_logs WHERE project_id = ${projectId}::uuid LIMIT ${PURGE_BATCH_SIZE})`,
      );
      await this.#deleteInBatches(
        () => db.$executeRaw`
          DELETE FROM tasks WHERE id IN (
            SELECT id FROM tasks WHERE project_id = ${projectId}::uuid LIMIT ${PURGE_BATCH_SIZE})`,
      );
    }
    await db.$executeRaw`DELETE FROM workspaces WHERE id = ${workspaceId}::uuid`;
    return true;
  }

  async #deleteInBatches(deleteBatch: () => Promise<number>): Promise<void> {
    while ((await deleteBatch()) === PURGE_BATCH_SIZE) {
      // tiếp tục tới khi một lô xóa ít hơn kích thước lô
    }
  }
}
