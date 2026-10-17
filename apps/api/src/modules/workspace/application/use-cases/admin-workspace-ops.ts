import type { IClock } from '../../../../core/domain';
import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { isOrphanWorkspace } from '../../domain/workspace';
import type { WorkspaceRole } from '../../domain/roles';
import type { IWorkspaceRealtimeNotifier } from '../ports/collaborators.port';
import type { AdminWorkspaceRow, IWorkspaceQueries } from '../ports/queries.port';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';

/** Một workspace cho màn Quản trị (T-061a) — khớp cấu trúc `AdminWorkspaceView` của company. */
export interface AdminWorkspaceView {
  id: string;
  name: string;
  deletedAt: Date | null;
  archivedAt: Date | null;
  orphan: boolean;
  members: { userId: string; fullName: string; role: WorkspaceRole }[];
}

const viewOf = (r: AdminWorkspaceRow): AdminWorkspaceView => ({
  ...r,
  orphan: isOrphanWorkspace({
    deletedAt: r.deletedAt,
    archivedAt: r.archivedAt,
    ownerCount: r.members.filter((m) => m.role === 'OWNER').length,
  }),
});

const deleted = () =>
  new ResourceConflictError({ reason: 'workspace_deleted' }, 'Workspace đã bị xóa hoặc lưu trữ.');

/**
 * Thao tác dữ liệu workspace cho Admin công ty (company-level ADR-134, T-061a) — hiện thực `IAdminWorkspaces` của
 * company (khớp cấu trúc, nối ở composition). KHÔNG kiểm quyền công ty / không audit: bên gọi (company) làm, cùng
 * transaction (`uow.run` lồng dùng chung). Không đọc dự án / task.
 */
export class AdminWorkspaceOps {
  constructor(
    private readonly d: {
      workspaces: IWorkspaceRepository;
      memberships: IMembershipRepository;
      queries: Pick<IWorkspaceQueries, 'listForAdmin' | 'findForAdmin'>;
      notifier: Pick<IWorkspaceRealtimeNotifier, 'notifyRoleChanged'>;
      uow: IUnitOfWork;
      clock: IClock;
    },
  ) {}

  async list(): Promise<AdminWorkspaceView[]> {
    return (await this.d.queries.listForAdmin()).map(viewOf);
  }

  /**
   * Giao OWNER cho THÀNH VIÊN HIỆN TẠI của ws mồ côi: khóa dòng OWNER (ADR-046 — tuần tự với mọi thao tác đổi OWNER) →
   * ws còn OWNER ⇒ 409 `workspace_has_owner`; xóa mềm / lưu trữ ⇒ 409 `workspace_deleted`; không là thành viên ⇒ 422
   * `NOT_WORKSPACE_MEMBER`. Phát `member:role-changed` sau commit.
   */
  assignOwner(q: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<AdminWorkspaceView> {
    const { d } = this;
    return d.uow.run(async () => {
      const owners = await d.memberships.lockOwners(q.workspaceId);
      const ws = await d.workspaces.findById(q.workspaceId);
      if (!ws) throw new ResourceNotFoundError('workspace');
      if (ws.isDeleted || ws.archivedAt !== null) throw deleted();
      if (owners.length > 0) {
        throw new ResourceConflictError(
          { reason: 'workspace_has_owner' },
          'Workspace vẫn còn chủ sở hữu.',
        );
      }
      const target = await d.memberships.find(q.workspaceId, q.userId);
      if (!target) throw notWorkspaceMember();
      target.changeRole('OWNER', d.clock.now());
      await d.memberships.save(target);
      d.uow.afterCommit(() =>
        d.notifier.notifyRoleChanged(
          { userId: q.userId, workspaceId: q.workspaceId, role: 'OWNER' },
          { actorId: q.actorId },
        ),
      );
      return viewOf((await d.queries.findForAdmin(q.workspaceId))!);
    });
  }

  /**
   * Lưu trữ ws 0 thành viên (mồ côi hoàn toàn): còn thành viên ⇒ 409 `workspace_has_members`; xóa mềm ⇒ 409
   * `workspace_deleted`; đã lưu trữ ⇒ trả lại như cũ (idempotent). Không purge, giữ dữ liệu.
   */
  archive(q: { workspaceId: string }): Promise<AdminWorkspaceView> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.memberships.lockOwners(q.workspaceId);
      const ws = await d.workspaces.findById(q.workspaceId);
      if (!ws) throw new ResourceNotFoundError('workspace');
      if (ws.isDeleted) throw deleted();
      if (ws.archivedAt === null) {
        if ((await d.memberships.listUserIds(q.workspaceId)).length > 0) {
          throw new ResourceConflictError(
            { reason: 'workspace_has_members' },
            'Workspace còn thành viên — giao chủ sở hữu thay vì lưu trữ.',
          );
        }
        if (!(await d.workspaces.archive(q.workspaceId, d.clock.now()))) throw deleted();
      }
      return viewOf((await d.queries.findForAdmin(q.workspaceId))!);
    });
  }
}

export function notWorkspaceMember(): BusinessRuleViolationError {
  return new BusinessRuleViolationError(
    'NOT_WORKSPACE_MEMBER',
    'Người được giao phải là thành viên hiện tại của workspace và còn thuộc công ty.',
  );
}
