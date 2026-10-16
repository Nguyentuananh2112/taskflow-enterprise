import type {
  AudienceWorkspace,
  INotificationAudience,
  INotificationContextReader,
  LeaveSummary,
  MemberAccess,
} from '../../application/ports';
import type { DbProvider } from './prisma-notification.store';

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Membership hiện tại — đọc `workspace_members` mỗi lần gọi (không cache, không tin token — B-H3b).
 * Chỉ đọc; bảng thuộc Workspace (ghi chú handoff: TL quyết có chuyển adapter sang module đó không).
 */
export class PrismaNotificationAudience implements INotificationAudience {
  constructor(private readonly db: DbProvider) {}

  async workspacesOf(userId: string): Promise<AudienceWorkspace[]> {
    const rows = await this.db().workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      select: {
        workspaceId: true,
        role: true,
        grants: true,
        joinedAt: true,
        workspace: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      userId,
      workspaceId: r.workspaceId,
      workspaceName: r.workspace.name,
      role: r.role,
      grants: r.grants,
      joinedAt: r.joinedAt,
    }));
  }

  membersOf(workspaceId: string): Promise<MemberAccess[]> {
    return this.db().workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true, role: true, grants: true },
    });
  }
}

/** Ngữ cảnh DTO: tên actor + loại/khoảng ngày của đơn. `select` tường minh — KHÔNG đọc `reason` (B-H2). */
export class PrismaNotificationContextReader implements INotificationContextReader {
  constructor(private readonly db: DbProvider) {}

  async actorNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db().user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  async leaveSummaries(
    refs: readonly { workspaceId: string; refId: string }[],
  ): Promise<ReadonlyMap<string, LeaveSummary>> {
    if (refs.length === 0) return new Map();
    const rows = await this.db().leaveRequest.findMany({
      where: { OR: refs.map((r) => ({ id: r.refId, workspaceId: r.workspaceId })) },
      select: { id: true, type: true, startDate: true, endDate: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { type: r.type, startDate: dateOnly(r.startDate), endDate: dateOnly(r.endDate) },
      ]),
    );
  }
}
