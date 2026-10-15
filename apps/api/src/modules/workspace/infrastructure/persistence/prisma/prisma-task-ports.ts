import type { WorkspaceRole } from '../../../domain/roles';
import type { DbProvider } from './db';

// TODO(T-018): thay các bản sao cục bộ dưới đây bằng
// `import type { IAssigneeDirectory, ITaskProjectStore, ProjectKey, ProjectRef } from '../../../../task'`
// khi feat/T-018 merge (chữ ký đã chốt với C; modules/task/index.ts là type-only).
export interface IAssigneeDirectory {
  roleOf(input: { workspaceId: string; userId: string }): Promise<WorkspaceRole | null>;
}
export interface ProjectKey {
  workspaceId: string;
  projectId: string;
}
export interface ProjectRef {
  id: string;
  workspaceId: string;
  keyPrefix: string;
  isArchived: boolean;
}
export interface ITaskProjectStore {
  findInWorkspace(input: ProjectKey): Promise<ProjectRef | null>;
  allocateTaskNumber(input: ProjectKey): Promise<number | null>;
}

/**
 * Role của người được gán (ADR-044, security.md 3.5). `FOR SHARE OF m` khóa CHỈ dòng membership,
 * xếp hàng với khóa ghi khi hạ VIEWER/xóa member (ROL-07). User đã ẩn danh hóa ⇒ null.
 * Gọi TRONG transaction của use case assign/create (module Task).
 */
export class PrismaAssigneeDirectory implements IAssigneeDirectory {
  constructor(private readonly db: DbProvider) {}

  async roleOf(input: { workspaceId: string; userId: string }): Promise<WorkspaceRole | null> {
    const rows = await this.db().$queryRaw<{ role: WorkspaceRole }[]>`
      SELECT m.role FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ${input.workspaceId}::uuid AND m.user_id = ${input.userId}::uuid
         AND u.deleted_at IS NULL
       FOR SHARE OF m`;
    return rows[0]?.role ?? null;
  }
}

/** Project cho module Task (FR-03, data-and-api 1.2). Mọi truy vấn có phạm vi tenant, loại ws đã xóa. */
export class PrismaTaskProjectStore implements ITaskProjectStore {
  constructor(private readonly db: DbProvider) {}

  async findInWorkspace(input: ProjectKey): Promise<ProjectRef | null> {
    const row = await this.db().project.findFirst({
      where: {
        id: input.projectId,
        workspaceId: input.workspaceId,
        workspace: { deletedAt: null },
      },
      select: { id: true, workspaceId: true, keyPrefix: true, archivedAt: true },
    });
    return row
      ? {
          id: row.id,
          workspaceId: row.workspaceId,
          keyPrefix: row.keyPrefix,
          isArchived: row.archivedAt !== null,
        }
      : null;
  }

  /**
   * Cấp số `KEY-n` an toàn đồng thời: `UPDATE … RETURNING` khóa dòng project tới hết transaction.
   * SQL tay nên tự đặt `updated_at` (`@updatedAt` của Prisma không chạy) — C phát hiện, data-and-api §1.2.
   * Project archived / ∉ ws / ws đã xóa ⇒ `null` (không ném — use case tự phân biệt 404 với 422).
   */
  async allocateTaskNumber(input: ProjectKey): Promise<number | null> {
    const rows = await this.db().$queryRaw<{ number: number }[]>`
      UPDATE projects p SET next_task_number = p.next_task_number + 1, updated_at = now()
       WHERE p.id = ${input.projectId}::uuid AND p.workspace_id = ${input.workspaceId}::uuid
         AND p.archived_at IS NULL
         AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = p.workspace_id AND w.deleted_at IS NULL)
      RETURNING p.next_task_number - 1 AS number`;
    return rows[0]?.number ?? null;
  }
}
