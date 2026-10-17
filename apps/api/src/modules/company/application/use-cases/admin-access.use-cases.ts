import type { AccessDto } from '@taskflow/contracts';

import type { IClock, IIdGenerator } from '../../../../core/domain';
import { addDays, toLocal } from '../../../../core/domain/local-time';
import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
  VersionConflictError,
} from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { employeeStatusOf, type CompanyMemberSnapshot } from '../../domain/company-member';
import type { CompanyGrant, CompanyRole } from '../../domain/roles';
import type { CompanyAccess } from '../company-access';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { ICompanyAccessEvents } from '../ports/access-events.port';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { ICompanyMemberRepository } from '../ports/company-member.port';
import type { IOffboardLeavePort } from '../ports/offboard-leave.port';

export interface SetAccessInput {
  actorId: string;
  userId: string;
  role: CompanyRole;
  grants: readonly CompanyGrant[];
  expectedVersion: number;
}

const sameGrants = (a: readonly CompanyGrant[], b: readonly CompanyGrant[]) =>
  a.length === b.length && a.every((g) => b.includes(g));

/**
 * `GET / PUT /admin/access` (company-level ADR-134/135, T-061a): Admin xem và đổi role ADMIN↔EMPLOYEE + grants
 * HR_MANAGE / PAYROLL_MANAGE của người khác.
 *
 * Thứ tự khóa (ADR-136): `taskflow:company:admins` (bậc 2 — mọi lệnh đổi quyền tuần tự với nhau và với bootstrap /
 * hoàn tất nghỉ việc) → nâng EMPLOYEE→ADMIN thì `leave:<U>` rồi `punch:<U>` (bậc 3, D HIGH-1) → dòng `company_members`
 * (bậc 5: actor FOR SHARE trong `authorizeWrite`, rồi người bị đổi).
 * - Nâng EMPLOYEE→ADMIN: đóng nhiệm kỳ `ROLE_CHANGED` tới HÔM NAY (ngày đổi vẫn tính công), dọn đơn sau ngày đó
 *   (`offboardCleanup`) TRƯỚC khi UPDATE dòng, thu hồi phiên (ADR-105 — phiên cũ mang quyền cũ).
 * - Hạ ADMIN→EMPLOYEE: nhiệm kỳ mới từ NGÀY MAI (CO-09), thu hồi phiên; còn đúng một Admin ⇒ 409 `last_admin`.
 * - Chỉ đổi grants của EMPLOYEE: không thu hồi phiên (quyền đọc DB mỗi request).
 * Luật self tuyệt đối (403). Admin + grants ⇒ 422 `GRANT_NOT_ALLOWED`. Lệch version ⇒ 409.
 */
export class AdminAccessUseCases {
  constructor(
    private readonly d: {
      access: Pick<CompanyAccess, 'authorizeWrite'>;
      members: ICompanyMemberRepository;
      accounts: Pick<ICompanyAccounts, 'profiles' | 'revokeSessions'>;
      audit: Pick<HrAuditWriter, 'record'>;
      offboardLeave: IOffboardLeavePort;
      events: ICompanyAccessEvents;
      uow: IUnitOfWork;
      ids: IIdGenerator;
      /** Giờ NGHIỆP VỤ — ngày đóng / mở nhiệm kỳ. */
      clock: IClock;
      timeZone: () => Promise<string>;
    },
  ) {}

  /** Mọi người đang thuộc công ty (Admin + nhân viên), sắp theo tên. Quyền `company:admin` do route kiểm. */
  async list(): Promise<AccessDto[]> {
    const members = await this.d.members.listAll();
    const profiles = await this.d.accounts.profiles(members.map((m) => m.userId));
    return members
      .map((m) => this.#dto(m, profiles.get(m.userId)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi') || (a.userId < b.userId ? -1 : 1));
  }

  async set(input: SetAccessInput): Promise<AccessDto> {
    const grants = [...new Set(input.grants)];
    if (input.role === 'ADMIN' && grants.length > 0) {
      throw new BusinessRuleViolationError(
        'GRANT_NOT_ALLOWED',
        'Admin đã có mọi quyền — không cấp thêm quyền riêng.',
      );
    }
    const { d } = this;
    const updated = await d.uow.run(async () => {
      await d.members.lockAdmins();
      // Đọc KHÔNG khóa để biết có phải nâng EMPLOYEE→ADMIN (cần khóa leave/punch TRƯỚC khi khóa dòng nào).
      const peek = await d.members.find(input.userId);
      const promoting = peek?.role === 'EMPLOYEE' && input.role === 'ADMIN';
      if (promoting) await d.members.lockEmployeeWork(input.userId);
      await d.access.authorizeWrite({
        actorId: input.actorId,
        permission: 'company:grant',
        targetUserId: input.userId,
      });
      const cur = await d.members.findForShare(input.userId);
      if (!cur) throw new ResourceNotFoundError('user');
      // Role đổi giữa lúc đọc và lúc khóa ⇒ coi như bản đã cũ (thứ tự khóa phải đúng theo role thật).
      if (cur.version !== input.expectedVersion || cur.role !== peek?.role) {
        throw new VersionConflictError(cur.version);
      }
      const next = await this.#apply(cur, { ...input, grants });
      if (next) {
        await d.events.accessChanged({ userId: input.userId, actorId: input.actorId });
        d.uow.afterCommit(() =>
          d.events.pushAccessChanged({
            userId: next.userId,
            role: next.role,
            grants: next.grants,
            actorId: input.actorId,
          }),
        );
      }
      return next ?? cur;
    });
    const profiles = await d.accounts.profiles([updated.userId]);
    return this.#dto(updated, profiles.get(updated.userId));
  }

  /** Áp thay đổi trên dòng đã khóa; `null` = không có gì đổi. */
  async #apply(
    cur: CompanyMemberSnapshot,
    input: SetAccessInput & { grants: CompanyGrant[] },
  ): Promise<CompanyMemberSnapshot | null> {
    const { d } = this;
    const { actorId, userId, role, grants } = input;
    const now = d.clock.now();
    if (cur.role === role) {
      if (role === 'ADMIN' || sameGrants(cur.grants, grants)) return null;
      const next = await d.members.setGrants(userId, grants, now);
      if (!next) throw new VersionConflictError(cur.version);
      await d.audit.record({
        actorId,
        action: 'GRANT_SET',
        targetUserId: userId,
        before: { grants: cur.grants },
        after: { grants },
      });
      return next;
    }
    const today = toLocal(now, await d.timeZone()).date;
    let next: CompanyMemberSnapshot | null;
    if (role === 'ADMIN') {
      // EMPLOYEE → ADMIN (khóa leave / punch đã lấy ở `set`).
      const firstDay = cur.startDate ?? today;
      const lastDay = today < firstDay ? firstDay : today;
      await d.members.recordDeparture({
        id: d.ids.next(),
        userId,
        role: 'EMPLOYEE',
        firstDay,
        lastDay,
        leftAt: now,
        reason: 'ROLE_CHANGED',
      });
      await d.offboardLeave.offboardCleanup({ userId, lastDay, actorId });
      next = await d.members.promoteToAdmin(userId, now);
    } else {
      // ADMIN → EMPLOYEE.
      const admins = await d.members.listAdmins();
      if (admins.length <= 1) {
        throw new ResourceConflictError(
          { reason: 'last_admin' },
          'Công ty phải luôn còn ít nhất một Admin.',
        );
      }
      next = await d.members.demoteToEmployee(userId, {
        startDate: addDays(today, 1),
        grants,
        at: now,
      });
    }
    if (!next) throw new VersionConflictError(cur.version);
    await d.accounts.revokeSessions(userId, 'LOGOUT_ALL');
    await d.audit.record({
      actorId,
      action: 'COMPANY_ROLE_SET',
      targetUserId: userId,
      before: { role: cur.role, grants: cur.grants },
      after: { role: next.role, grants: next.grants },
    });
    return next;
  }

  #dto(
    m: CompanyMemberSnapshot,
    profile: { fullName: string; email: string; hasPassword: boolean } | undefined,
  ): AccessDto {
    return {
      userId: m.userId,
      fullName: profile?.fullName ?? '',
      email: profile?.email ?? '',
      role: m.role,
      grants: [...m.grants],
      status:
        employeeStatusOf({
          member: m,
          hasPassword: profile?.hasPassword ?? false,
          hasDeparture: false,
        }) ?? 'ACTIVE',
      version: m.version,
    };
  }
}
