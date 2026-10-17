import type { IClock } from '../../../core/domain';
import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import { isCompanyAccessActive } from '../domain/company-member';
import { effectiveCompanyPermissions, type CompanyPermission } from '../domain/roles';
import type { CompanyActor, ICompanyMemberRepository } from './ports/company-member.port';

export interface CompanyWriteInput {
  actorId: string;
  /** Mặc định `hr:manage`. Payroll (Mốc 4) truyền `payroll:manage`; quản trị truyền `company:*`. */
  permission?: CompanyPermission;
  /** Người bị tác động; trùng `actorId` ⇒ 403 (luật self tuyệt đối — Admin không có dữ liệu nhân viên). */
  targetUserId?: string | null;
}

/**
 * `ICompanyAccess` (ADR-135/136) — chốt chung cho lệnh ghi cấp công ty và lệnh của nhân viên. Gọi TRONG
 * transaction của bên gọi, theo thứ tự khóa toàn cục ADR-136 (khóa nghiệp vụ advisory TRƯỚC, dòng
 * `company_members` SAU).
 */
export class CompanyAccess {
  constructor(private readonly d: { members: ICompanyMemberRepository; clock: IClock }) {}

  /**
   * Khóa dòng của người gọi FOR SHARE, đọc lại role + grants (thu quyền có hiệu lực ngay — B-H3). Không còn
   * thuộc công ty / quá `access_until` ⇒ 401 SESSION_REVOKED; thiếu quyền ⇒ 403; tự xử lý ⇒ 403.
   */
  async authorizeWrite(input: CompanyWriteInput): Promise<CompanyActor> {
    const permission = input.permission ?? 'hr:manage';
    const me = await this.d.members.findForShare(input.actorId);
    if (!me || !isCompanyAccessActive(me, this.d.clock.now())) throw new SessionRevokedError();
    if (!effectiveCompanyPermissions(me.role, me.grants).has(permission)) {
      throw new ForbiddenError(permission);
    }
    if (input.targetUserId != null && input.targetUserId === input.actorId) {
      throw new ForbiddenError(permission);
    }
    return { userId: me.userId, role: me.role, grants: [...me.grants] };
  }

  /** Nhân viên = dòng `company_members` có role EMPLOYEE (kể cả đang có lịch nghỉ, chưa kích hoạt). */
  async isEmployee(userId: string): Promise<boolean> {
    const m = await this.d.members.find(userId);
    return m !== null && m.role === 'EMPLOYEE';
  }

  /**
   * Lệnh của chính nhân viên (chấm công, đơn nghỉ — A C2): gọi SAU khóa nghiệp vụ (`punch:<user>` /
   * `leave:<user>`), khóa dòng FOR SHARE; không còn là nhân viên đang có quyền ⇒ 401 SESSION_REVOKED.
   */
  async assertActiveEmployee(userId: string): Promise<void> {
    const m = await this.d.members.findForShare(userId);
    if (!m || m.role !== 'EMPLOYEE' || !isCompanyAccessActive(m, this.d.clock.now())) {
      throw new SessionRevokedError();
    }
  }
}
