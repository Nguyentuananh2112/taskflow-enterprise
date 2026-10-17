import type { LocalDate } from '../../../core/domain/local-time';
import {
  applyPatch,
  hasPatch,
  sameFields,
  fieldsOf,
  type ProfilePatch,
} from '../domain/employee-profile';
import { assertHireDateNotFuture, type ProfileWriter } from './profile-writer';
import type { IEmployeeProfileRepository, IProfileLocks } from './ports/employee-profile.port';

export interface HireProfileInput {
  actorId: string;
  userId: string;
  /** Có tài khoản cũ (nhận lại) — audit `after.rehire = true`. */
  rehire: boolean;
  patch: ProfilePatch;
  keepHireDate?: boolean | undefined;
}

/**
 * Phần hồ sơ của `POST hr/employees` mở rộng (T-054, ADR-128) — module company gọi TRONG transaction thêm nhân
 * viên (lỗi ở đây ⇒ rollback cả nhân viên). Không gửi trường nào ⇒ như Mốc 3.5 (không tạo / không đổi hồ sơ).
 * Nhận lại có hồ sơ cũ: `keepHireDate: true` giữ `hireDate` cũ (bỏ qua `hireDate` gửi kèm); `false` thay bằng
 * `hireDate` gửi kèm (không gửi ⇒ xóa — thâm niên tính lại khi HR nhập); không gửi gì ⇒ giữ nguyên hồ sơ cũ.
 */
export class HireProfileHooks {
  constructor(
    private readonly d: {
      profiles: IEmployeeProfileRepository;
      locks: IProfileLocks;
      writer: ProfileWriter;
    },
  ) {}

  /** Body có phần hồ sơ ⇒ cần khóa `taskflow:leave-policy` (bậc 1) TRƯỚC mọi khóa khác của lệnh. */
  wantsProfile(input: Pick<HireProfileInput, 'patch' | 'keepHireDate'>): boolean {
    return hasPatch(input.patch) || input.keepHireDate !== undefined;
  }

  lockBeforeHire(): Promise<void> {
    return this.d.locks.lockLeavePolicyShared();
  }

  /** 422 `HIRE_DATE_IN_FUTURE` — cùng chỗ với `START_DATE_OUT_OF_RANGE` của thêm nhân viên. */
  validate(input: Pick<HireProfileInput, 'patch'>, today: LocalDate): void {
    assertHireDateNotFuture(input.patch.hireDate, today);
  }

  async applyOnHire(input: HireProfileInput): Promise<void> {
    if (!this.wantsProfile(input)) return;
    const current = await this.d.profiles.findForUpdate(input.userId);
    const patch: ProfilePatch = { ...input.patch };
    if (current && input.keepHireDate === true) patch.hireDate = current.hireDate;
    if (current && input.keepHireDate === false) patch.hireDate = input.patch.hireDate ?? null;
    const next = applyPatch(current, patch);
    if (sameFields(fieldsOf(current), next)) return;
    await this.d.writer.write({
      actorId: input.actorId,
      userId: input.userId,
      current,
      next,
      rehire: input.rehire,
    });
  }
}
