import { Entity } from '../../../core/domain';
import type { WorkspaceRole } from './roles';

export interface MembershipSnapshot {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
  updatedAt: Date;
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
      joinedAt: input.now,
      updatedAt: input.now,
    });
  }

  static reconstitute(snapshot: MembershipSnapshot): Membership {
    return new Membership({ ...snapshot });
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
  get joinedAt(): Date {
    return this.s.joinedAt;
  }

  /** `false` khi role không đổi (no-op: không audit, không event — ROL-08). */
  changeRole(role: WorkspaceRole, now: Date): boolean {
    if (role === this.s.role) return false;
    this.s.role = role;
    this.s.updatedAt = now;
    return true;
  }

  toSnapshot(): MembershipSnapshot {
    return { ...this.s };
  }
}
