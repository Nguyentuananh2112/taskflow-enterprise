import {
  BusinessRuleViolationError,
  ForbiddenError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import { roleAllows } from '../../domain/roles';
import type { IMembershipRepository, IWorkspaceRepository } from '../ports/repositories.port';
import { requirePermission, type Actor } from '../workspace-shared';

export interface HrWriteInput {
  workspaceId: string;
  /** Người gọi (từ access token) — role / grants đọc LẠI ở đây, không tin bản của middleware. */
  actorId: string;
  /** Nhân viên bị tác động (đơn của ai, lượt chấm của ai, số dư của ai); không có ⇒ lệnh cấp công ty. */
  targetUserId?: string | null;
  /** Lý do người gọi nhập (bắt buộc khi OWNER tự xử lý dữ liệu của mình). */
  reason?: string | null;
}

/**
 * Chốt chung cho MỌI lệnh ghi cần `hr:manage` (attendance-leave.md §9, B-H1 / B-H3a). Gọi TRONG
 * transaction của bên gọi, TRƯỚC khi đọc / ghi dữ liệu nghiệp vụ:
 *
 * 1. Khóa dòng membership của chính người gọi `FOR SHARE` rồi đọc lại role + grants. Thu grant
 *    (`PUT …/grants`, UPDATE dòng đó) chạy song song ⇒ một bên chờ bên kia commit: lệnh HR thấy
 *    quyền SAU khi thu ⇒ 403; không có lượt duyệt nào commit sau khi thu (SEC-HR-10, CC-HR-11).
 *    Không còn là thành viên / ws đã xóa ⇒ 404 workspace (như `loadMembership`).
 * 2. Luật "không tự xử lý dữ liệu của mình": `targetUserId === actorId` ⇒ 403, TRỪ OWNER; OWNER tự
 *    làm ⇒ bắt buộc lý do, thiếu ⇒ 422 `REASON_REQUIRED` (quy ước chung với T-038 / T-039).
 *
 * Trả Actor đã đọc lại để bên gọi ghi audit đúng người / đúng quyền.
 */
export class HrAccess {
  constructor(
    private readonly d: { workspaces: IWorkspaceRepository; memberships: IMembershipRepository },
  ) {}

  async authorizeWrite(input: HrWriteInput): Promise<Actor> {
    const { workspaceId, actorId } = input;
    const workspace = await this.d.workspaces.findById(workspaceId);
    if (!workspace || workspace.isDeleted) throw new ResourceNotFoundError('workspace');
    const me = await this.d.memberships.findForShare(workspaceId, actorId);
    if (!me) throw new ResourceNotFoundError('workspace');
    const actor: Actor = { userId: actorId, workspaceId, role: me.role, grants: [...me.grants] };
    requirePermission(actor, 'hr:manage');

    if (input.targetUserId != null && input.targetUserId === actorId) {
      if (actor.role !== 'OWNER') throw new ForbiddenError('hr:manage');
      if (!input.reason?.trim()) {
        throw new BusinessRuleViolationError(
          'REASON_REQUIRED',
          'Tự xử lý dữ liệu nhân sự của chính mình cần ghi lý do.',
        );
      }
    }
    return actor;
  }

  /**
   * Nhân viên hiện tại của workspace = thành viên có `attendance:self` (OWNER / PM / MEMBER — VIEWER
   * là khách). Dùng khi nhận đơn / chấm công cho một người (D: `isEligibleRequester`).
   */
  async isEmployee(input: { workspaceId: string; userId: string }): Promise<boolean> {
    const m = await this.d.memberships.find(input.workspaceId, input.userId);
    return m !== null && roleAllows(m.role, 'attendance:self');
  }
}
