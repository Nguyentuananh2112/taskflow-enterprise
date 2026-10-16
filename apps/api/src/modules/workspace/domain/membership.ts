import { Entity } from '../../../core/domain';
import { BusinessRuleViolationError } from '../../../core/errors';
import { MEMBER_GRANTS, canHoldGrants, type MemberGrant, type WorkspaceRole } from './roles';

export interface MembershipSnapshot {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** ADR-119; luôn `[]` với OWNER / VIEWER (CHECK `workspace_members_grants_role_chk`). */
  grants: MemberGrant[];
  joinedAt: Date;
  updatedAt: Date;
}

/** Thứ tự cố định theo `MEMBER_GRANTS`, không trùng ⇒ so sánh / lưu ổn định. */
function normalizeGrants(grants: readonly MemberGrant[]): MemberGrant[] {
  return MEMBER_GRANTS.filter((g) => grants.includes(g));
}

/**
 * Thành viên của một workspace. Luật LAST_OWNER cần nhìn mọi dòng OWNER (khóa FOR UPDATE —
 * ADR-046) nên nằm ở application, không ở entity.
 */
export class Membership extends Entity {
  private constructor(private readonly s: MembershipSnapshot) {
    super(s.id);
  }

  static create(input: {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    now: Date;
  }): Membership {
    return new Membership({
      id: input.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      grants: [],
      joinedAt: input.now,
      updatedAt: input.now,
    });
  }

  static reconstitute(snapshot: MembershipSnapshot): Membership {
    return new Membership({ ...snapshot, grants: normalizeGrants(snapshot.grants ?? []) });
  }

  get workspaceId(): string {
    return this.s.workspaceId;
  }
  get userId(): string {
    return this.s.userId;
  }
  get role(): WorkspaceRole {
    return this.s.role;
  }
  get grants(): readonly MemberGrant[] {
    return this.s.grants;
  }
  get joinedAt(): Date {
    return this.s.joinedAt;
  }

  /** `false` khi role không đổi (no-op: không audit, không event — ROL-08). */
  changeRole(role: WorkspaceRole, now: Date): boolean {
    if (role === this.s.role) return false;
    this.s.role = role;
    // ADR-119 / B-M2: OWNER có HR qua role, VIEWER không phải nhân viên ⇒ grants về [] CÙNG lúc đổi role.
    if (!canHoldGrants(role)) this.s.grants = [];
    this.s.updatedAt = now;
    return true;
  }

  /**
   * Đặt TOÀN BỘ tập grant (idempotent). OWNER / VIEWER ⇒ 422 `GRANT_NOT_ALLOWED` — kể cả `[]` cho
   * OWNER (OWNER không có grant tường minh để thu — SEC-HR-27). `false` khi không đổi gì.
   */
  setGrants(grants: readonly MemberGrant[], now: Date): boolean {
    if (!canHoldGrants(this.s.role)) {
      throw new BusinessRuleViolationError(
        'GRANT_NOT_ALLOWED',
        this.s.role === 'OWNER'
          ? 'OWNER đã có mọi quyền qua vai trò — không cấp / thu quyền riêng.'
          : 'Không cấp quyền quản lý nhân sự cho người xem.',
      );
    }
    const next = normalizeGrants(grants);
    if (next.length === this.s.grants.length && next.every((g, i) => this.s.grants[i] === g))
      return false;
    this.s.grants = next;
    this.s.updatedAt = now;
    return true;
  }

  toSnapshot(): MembershipSnapshot {
    return { ...this.s, grants: [...this.s.grants] };
  }
}
