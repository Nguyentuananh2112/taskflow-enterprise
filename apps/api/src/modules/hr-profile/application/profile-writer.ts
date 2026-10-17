import type { IClock } from '../../../core/domain';
import { toLocal, type LocalDate } from '../../../core/domain/local-time';
import { BusinessRuleViolationError, VersionConflictError } from '../../../core/errors';
import {
  fieldsOf,
  profileAuditView,
  type EmployeeProfileSnapshot,
  type ProfileFields,
} from '../domain/employee-profile';
import type { IEmployeeProfileRepository, IProfileAudit } from './ports/employee-profile.port';

/** "Hôm nay" theo giờ nghiệp vụ + múi giờ lịch công ty (ADR-120) — cận trên `hireDate`, gốc tính thâm niên. */
export async function businessToday(d: {
  clock: IClock;
  timeZone: () => Promise<string>;
}): Promise<LocalDate> {
  return toLocal(d.clock.now(), await d.timeZone()).date;
}

/**
 * Cận trên `hireDate ≤ hôm nay` phụ thuộc giờ nghiệp vụ ⇒ luật nghiệp vụ 422 `HIRE_DATE_IN_FUTURE` (TL chốt 17/10,
 * cùng kiểu `START_DATE_OUT_OF_RANGE`), không phải validate 400.
 */
export function assertHireDateNotFuture(hireDate: LocalDate | null | undefined, today: LocalDate) {
  if (hireDate && hireDate > today) {
    throw new BusinessRuleViolationError(
      'HIRE_DATE_IN_FUTURE',
      'Ngày vào công ty không được ở tương lai.',
    );
  }
}

/**
 * Ghi hồ sơ + audit `PROFILE_SET` CÙNG transaction — dùng chung cho `PUT hr/employee-profiles/:userId` và
 * `POST hr/employees` mở rộng (T-054). Version lệch (đua) ⇒ 409 kèm bản hiện tại.
 */
export class ProfileWriter {
  constructor(
    private readonly d: {
      profiles: IEmployeeProfileRepository;
      audit: IProfileAudit;
      clock: IClock;
    },
  ) {}

  async write(input: {
    actorId: string;
    userId: string;
    current: EmployeeProfileSnapshot | null;
    next: ProfileFields;
    note?: string | undefined;
    rehire?: boolean;
  }): Promise<EmployeeProfileSnapshot> {
    const { current, next } = input;
    const saved = await this.d.profiles.save({
      userId: input.userId,
      fields: next,
      expectedVersion: current?.version ?? 0,
      updatedById: input.actorId,
      at: this.d.clock.now(),
    });
    if (!saved) {
      const latest = await this.d.profiles.find(input.userId);
      throw new VersionConflictError(latest?.version ?? 0);
    }
    const before = current ? profileAuditView(fieldsOf(current)) : null;
    await this.d.audit.record({
      actorId: input.actorId,
      action: 'PROFILE_SET',
      targetUserId: input.userId,
      before,
      after: {
        ...profileAuditView(next),
        workPhoneChanged: (current?.workPhone ?? null) !== next.workPhone,
        ...(input.note ? { note: input.note } : {}),
        ...(input.rehire ? { rehire: true } : {}),
      },
    });
    return saved;
  }
}
