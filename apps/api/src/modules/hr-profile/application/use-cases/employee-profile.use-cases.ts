import type { IClock } from '../../../../core/domain';
import type { LocalDate } from '../../../../core/domain/local-time';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  ResourceNotFoundError,
  SessionRevokedError,
  VersionConflictError,
} from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import {
  applyPatch,
  fieldsOf,
  sameFields,
  seniorityFor,
  type EmployeeProfileSnapshot,
  type ProfilePatch,
} from '../../domain/employee-profile';
import { assertHireDateNotFuture, businessToday, type ProfileWriter } from '../profile-writer';
import type {
  IEmployeeProfileRepository,
  IProfileAccess,
  IProfileLeaveBalances,
  IProfileLocks,
  IProfileNotifier,
  IProfilePeople,
  ProfilePersonStatus,
} from '../ports/employee-profile.port';

/** = `EmployeeProfileDto` của contracts. */
export interface EmployeeProfileView {
  userId: string;
  fullName: string;
  status: ProfilePersonStatus;
  hireDate: LocalDate | null;
  department: string | null;
  jobTitle: string | null;
  workPhone: string | null;
  version: number;
  seniority: { years: number; months: number } | null;
  missingHireDate: boolean;
}

export interface PutEmployeeProfileResult {
  profile: EmployeeProfileView;
  negativeBalances: { year: number; remainingDays: number }[];
  warnings: 'ADJUSTMENT_DAYS_REVIEW'[];
}

export interface EmployeeProfileDeps {
  profiles: IEmployeeProfileRepository;
  people: IProfilePeople;
  access: IProfileAccess;
  locks: IProfileLocks;
  notifier: IProfileNotifier;
  leaveBalances: IProfileLeaveBalances;
  writer: ProfileWriter;
  uow: IUnitOfWork;
  /** Giờ NGHIỆP VỤ (R31). */
  clock: IClock;
  /** Múi giờ lịch công ty (ADR-120). */
  timeZone: () => Promise<string>;
  logger: ILogger;
}

function viewOf(
  userId: string,
  person: { fullName: string; status: ProfilePersonStatus },
  p: EmployeeProfileSnapshot | null,
  today: LocalDate,
): EmployeeProfileView {
  const f = fieldsOf(p);
  return {
    userId,
    fullName: person.fullName,
    status: person.status,
    ...f,
    version: p?.version ?? 0,
    seniority: seniorityFor(f.hireDate, today),
    missingHireDate: f.hireDate === null,
  };
}

async function requirePermission(
  access: IProfileAccess,
  actorId: string,
  permission: 'hr:manage' | 'profile:self',
): Promise<void> {
  const permissions = await access.permissionsOf(actorId);
  if (!permissions) throw new SessionRevokedError();
  if (!permissions.has(permission)) throw new ForbiddenError(permission);
}

/**
 * Đọc hồ sơ (ADR-128): `hr:manage` đọc người TỪNG có nhiệm kỳ EMPLOYEE (đang làm / chờ kích hoạt / sắp nghỉ / đã
 * nghỉ) — chưa từng ⇒ 404 `user`; chưa có hồ sơ ⇒ trường null, `version 0`. `profile:self` chỉ EMPLOYEE (Admin 403).
 */
export class EmployeeProfileQueries {
  constructor(private readonly d: EmployeeProfileDeps) {}

  async get(actorId: string, userId: string): Promise<EmployeeProfileView> {
    await requirePermission(this.d.access, actorId, 'hr:manage');
    return this.#read(userId);
  }

  async me(actorId: string): Promise<EmployeeProfileView> {
    await requirePermission(this.d.access, actorId, 'profile:self');
    return this.#read(actorId);
  }

  async suggestions(actorId: string): Promise<{ departments: string[]; jobTitles: string[] }> {
    await requirePermission(this.d.access, actorId, 'hr:manage');
    return this.d.profiles.suggestions();
  }

  async #read(userId: string): Promise<EmployeeProfileView> {
    const today = await businessToday(this.d);
    return this.d.uow.run(async () => {
      const person = await this.d.people.employeeRef(userId);
      if (!person) throw new ResourceNotFoundError('user');
      return viewOf(userId, person, await this.d.profiles.find(userId), today);
    });
  }
}

/**
 * `PUT hr/employee-profiles/:userId` (ADR-128). Một transaction, khóa theo bảng ADR-136: có `hireDate` trong body ⇒
 * `taskflow:leave-policy` SHARED → `taskflow:leave:<user>` (bậc 1, 3) TRƯỚC `authorizeWrite` (dòng, bậc 5). Thứ tự
 * lỗi ADR-135: 401 / 403 (self tuyệt đối) → 400 (Zod) → 404 `user` → 422 `HIRE_DATE_IN_FUTURE` → 409
 * `VERSION_CONFLICT` → 422 `REASON_REQUIRED` (đổi `hireDate` ĐÃ CÓ mà thiếu lý do). Không đổi gì ⇒ không ghi (không audit, không thông báo).
 */
export class PutEmployeeProfileUseCase {
  constructor(private readonly d: EmployeeProfileDeps) {}

  execute(input: {
    actorId: string;
    userId: string;
    patch: ProfilePatch;
    expectedVersion: number;
    reason?: string | undefined;
  }): Promise<PutEmployeeProfileResult> {
    const { actorId, userId } = input;
    return this.d.uow.run(async () => {
      const touchesHireDate = input.patch.hireDate !== undefined;
      if (touchesHireDate) {
        await this.d.locks.lockLeavePolicyShared();
        await this.d.locks.lockLeave(userId);
      }
      await this.d.access.authorizeWrite({ actorId, targetUserId: userId });
      const person = await this.d.people.employeeRef(userId);
      if (!person) throw new ResourceNotFoundError('user');
      const today = await businessToday(this.d);
      assertHireDateNotFuture(input.patch.hireDate, today);

      const current = await this.d.profiles.findForUpdate(userId);
      const currentVersion = current?.version ?? 0;
      if (input.expectedVersion !== currentVersion) {
        throw new VersionConflictError(currentVersion, viewOf(userId, person, current, today));
      }
      const next = applyPatch(current, input.patch);
      const previousHireDate = current?.hireDate ?? null;
      if (previousHireDate !== null && next.hireDate !== previousHireDate && !input.reason) {
        throw new BusinessRuleViolationError(
          'REASON_REQUIRED',
          'Sửa ngày vào công ty đã có cần ghi lý do.',
        );
      }
      if (current ? sameFields(fieldsOf(current), next) : sameFields(fieldsOf(null), next)) {
        return {
          profile: viewOf(userId, person, current, today),
          negativeBalances: [],
          warnings: [],
        };
      }

      const saved = await this.d.writer.write({
        actorId,
        userId,
        current,
        next,
        note: input.reason,
      });
      const negativeBalances =
        next.hireDate !== previousHireDate
          ? await this.d.leaveBalances.negativeBalancesIfHireDate({
              userId,
              hireDate: next.hireDate,
            })
          : [];
      // Người đã nghỉ không còn đăng nhập ⇒ không gửi thông báo (dòng sẽ không bao giờ được đọc).
      if (person.status !== 'LEFT') {
        await this.d.notifier.notify({
          type: 'PROFILE_UPDATED',
          refId: userId,
          actorId,
          recipient: { kind: 'user', userId },
        });
      }
      this.d.uow.afterCommit(() => {
        this.d.logger.info(
          { actorId, userId, version: saved.version, hireDateChanged: touchesHireDate },
          'hr_profile.updated',
        );
      });
      return { profile: viewOf(userId, person, saved, today), negativeBalances, warnings: [] };
    });
  }
}
