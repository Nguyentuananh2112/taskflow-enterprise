import type { AdminWorkspaceDto } from '@taskflow/contracts';

import { BusinessRuleViolationError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyAccess } from '../company-access';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { AdminWorkspaceView, IAdminWorkspaces } from '../ports/admin-workspaces.port';
import type { ICompanyMemberRepository } from '../ports/company-member.port';

const dtoOf = (w: AdminWorkspaceView): AdminWorkspaceDto => ({
  id: w.id,
  name: w.name,
  owners: w.members
    .filter((m) => m.role === 'OWNER')
    .map((m) => ({ id: m.userId, fullName: m.fullName })),
  memberCount: w.members.length,
  orphan: w.orphan,
  members: w.orphan ? w.members.map((m) => ({ userId: m.userId, fullName: m.fullName })) : [],
  deletedAt: w.deletedAt?.toISOString() ?? null,
  archivedAt: w.archivedAt?.toISOString() ?? null,
});

/**
 * `/admin/workspaces` (company-level ADR-134, T-061a): Admin xem mọi workspace (tên, OWNER, số thành viên, cờ mồ côi —
 * không dự án / task), giao OWNER cho thành viên còn lại của ws mồ côi, lưu trữ ws 0 thành viên. Admin KHÔNG có quyền
 * ngầm vào dự án; tự nhận OWNER chỉ khi vốn là thành viên ws đó.
 *
 * Thứ tự khóa (ADR-136): `company:admins` (tuần tự các lệnh quản trị) → dòng `company_members` của actor FOR SHARE
 * (`authorizeWrite` `company:admin`) → người được giao FOR SHARE → dòng OWNER của ws (trong adapter workspace).
 */
export class AdminWorkspacesUseCases {
  constructor(
    private readonly d: {
      access: Pick<CompanyAccess, 'authorizeWrite'>;
      members: Pick<ICompanyMemberRepository, 'lockAdmins' | 'findForShare'>;
      workspaces: () => IAdminWorkspaces;
      audit: Pick<HrAuditWriter, 'record'>;
      uow: IUnitOfWork;
    },
  ) {}

  async list(): Promise<AdminWorkspaceDto[]> {
    return (await this.d.workspaces().list()).map(dtoOf);
  }

  /**
   * Người được giao phải còn thuộc công ty và KHÔNG đang có lịch nghỉ (sắp mất quyền vào) — không thì 422
   * `NOT_WORKSPACE_MEMBER` như người ngoài ws.
   */
  assignOwner(q: {
    actorId: string;
    workspaceId: string;
    userId: string;
  }): Promise<AdminWorkspaceDto> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.members.lockAdmins();
      await d.access.authorizeWrite({ actorId: q.actorId, permission: 'company:admin' });
      const target = await d.members.findForShare(q.userId);
      if (!target || target.offboardLastDay !== null) {
        throw new BusinessRuleViolationError(
          'NOT_WORKSPACE_MEMBER',
          'Người được giao phải là thành viên hiện tại của workspace và còn thuộc công ty.',
        );
      }
      const view = await d.workspaces().assignOwner(q);
      await d.audit.record({
        actorId: q.actorId,
        action: 'WORKSPACE_OWNER_ASSIGNED',
        targetUserId: q.userId,
        refId: q.workspaceId,
        after: { role: 'OWNER' },
      });
      return dtoOf(view);
    });
  }

  archive(q: { actorId: string; workspaceId: string }): Promise<AdminWorkspaceDto> {
    const { d } = this;
    return d.uow.run(async () => {
      await d.members.lockAdmins();
      await d.access.authorizeWrite({ actorId: q.actorId, permission: 'company:admin' });
      const before = await d.workspaces().archive({ workspaceId: q.workspaceId });
      await d.audit.record({
        actorId: q.actorId,
        action: 'WORKSPACE_ARCHIVED',
        refId: q.workspaceId,
        after: { archivedAt: before.archivedAt?.toISOString() ?? null },
      });
      return dtoOf(before);
    });
  }
}
