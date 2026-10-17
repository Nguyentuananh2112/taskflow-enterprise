import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type {
  ITaskAssignmentCleaner,
  IWorkspaceRealtimeNotifier,
} from '../ports/collaborators.port';
import type { IWorkspaceQueries } from '../ports/queries.port';
import type {
  IMembershipRepository,
  IProjectRepository,
  IWorkspaceRepository,
} from '../ports/repositories.port';

/**
 * Hiện thực `IWorkspaceExitPort` của company (T-062, ADR-137 "Hoàn tất" bước 3 — khớp cấu trúc, ADR-093). Chạy TRONG
 * transaction hoàn tất nghỉ việc của bên gọi, SAU khi dòng `company_members` đã bị xóa.
 */
export class WorkspaceExit {
  constructor(
    private readonly d: {
      workspaces: IWorkspaceRepository;
      memberships: IMembershipRepository;
      projects: IProjectRepository;
      queries: IWorkspaceQueries;
      cleaner: ITaskAssignmentCleaner;
      notifier: IWorkspaceRealtimeNotifier;
      uow: IUnitOfWork;
      logger: ILogger;
    },
  ) {}

  /**
   * Từng ws (thứ tự id cố định): khóa OWNER (ADR-046) → xóa membership → bỏ gán task (ADR-044, actor = người lên
   * lịch); sau commit thu hồi phòng socket. Mồ côi = ws còn sống mà người này là OWNER cuối cùng (R39 — Admin giao
   * OWNER / lưu trữ).
   */
  async endMembership(input: {
    userId: string;
    actorId: string;
  }): Promise<{ workspaceIds: string[]; orphaned: string[] }> {
    const { userId, actorId } = input;
    const workspaceIds = await this.d.memberships.listWorkspaceIdsOfUser(userId);
    const orphaned: string[] = [];
    for (const workspaceId of workspaceIds) {
      const owners = await this.d.memberships.lockOwners(workspaceId);
      await this.d.memberships.remove(workspaceId, userId);
      const ws = await this.d.workspaces.findById(workspaceId);
      if (ws && !ws.isDeleted && owners.length === 1 && owners[0] === userId) {
        orphaned.push(workspaceId);
      }
      const projectIds = await this.d.projects.listIds(workspaceId);
      this.d.uow.afterCommit(() =>
        this.d.notifier.revokeWorkspaceAccess(
          { userId, workspaceId, projectIds },
          { actorId, originClientId: null },
        ),
      );
      await this.d.cleaner.unassignAllForUser({ workspaceId, userId, actorId });
    }
    if (orphaned.length > 0) {
      this.d.uow.afterCommit(() => {
        this.d.logger.warn({ userId, workspaceIds: orphaned }, 'workspace.orphaned_by_offboarding');
      });
    }
    return { workspaceIds, orphaned };
  }

  /** Cảnh báo khi lên lịch nghỉ: ws còn sống mà người này là OWNER DUY NHẤT (chỉ đọc, không khóa). */
  async soleOwnerWorkspaces(userId: string): Promise<{ id: string; name: string }[]> {
    const mine = await this.d.queries.listActiveForUser(userId);
    const out: { id: string; name: string }[] = [];
    for (const { workspace, role } of mine) {
      if (role !== 'OWNER') continue;
      let owners = 0;
      let after: string | undefined;
      do {
        const page = await this.d.queries.listMembers(workspace.id, null, { after, limit: 100 });
        owners += page.items.filter((m) => m.role === 'OWNER').length;
        after = page.nextAfter ?? undefined;
      } while (after && owners < 2);
      if (owners === 1) out.push({ id: workspace.id, name: workspace.name });
    }
    return out;
  }
}
