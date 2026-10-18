import type {
  PayrollSettingsDto,
  SalaryProfileDto,
  SalaryProfileVersionDto,
} from '@taskflow/contracts/payroll';

import { ResourceConflictError, VersionConflictError } from '../../../../core/errors';
import { profileVersionDto, refOf, settingsDto } from '../payroll-dto';
import { todayOf, type PayrollDeps } from '../payroll-kit';
import { profileFor } from '../payslip-numbers';

/**
 * Cài đặt lương (mức thâm niên / năm — một dòng) + hồ sơ lương theo phiên bản tháng (payroll.md ADR-124/125, T-049).
 * Ghi: `authorizeWrite(payroll:manage)`; hồ sơ của CHÍNH Kế toán ⇒ 403 (luật self). Đổi mức thâm niên khi có bảng NHÁP:
 * nháp giữ ảnh chụp cũ + cờ SENIORITY_RATE_CHANGED tới khi "Tính lại công".
 */
export class SettingsProfilesUseCases {
  constructor(private readonly d: PayrollDeps & { everEmployed(): Promise<string[]> }) {}

  async settings(): Promise<PayrollSettingsDto> {
    const s = await this.d.store.getSettings();
    const refs = await this.d.users.findRefs(s.updatedById ? [s.updatedById] : []);
    return settingsDto(s, refs);
  }

  async putSettings(
    actorId: string,
    q: { seniorityPerYear: number; expectedVersion: number },
  ): Promise<PayrollSettingsDto> {
    const { d } = this;
    await d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId });
      const before = await d.store.getSettings();
      const saved = await d.store.updateSettings({ ...q, updatedById: actorId, at: d.clock.now() });
      if (!saved) throw new VersionConflictError(before.version);
      await d.audit.record({
        actorId,
        action: 'PAYROLL_SETTINGS_SET',
        before: { seniorityPerYear: before.seniorityPerYear },
        after: { seniorityPerYear: saved.seniorityPerYear },
      });
    });
    return this.settings();
  }

  /** `GET payroll/salary-profiles` — người TỪNG là nhân viên; `hireDate` chỉ đọc (HR sửa — ADR-128). */
  async profiles(): Promise<SalaryProfileDto[]> {
    const { d } = this;
    const userIds = await d.everEmployed();
    const [versions, hireDates] = await Promise.all([
      d.store.listProfiles(userIds),
      d.hireDates.hireDates({ userIds }),
    ]);
    const refs = await d.users.findRefs([...userIds, ...versions.map((v) => v.createdById)]);
    const period = (await todayOf(d)).slice(0, 7);
    return userIds
      .map((userId) => {
        const mine = versions.filter((v) => v.userId === userId);
        const current = profileFor(mine, period);
        return {
          userId,
          user: refOf(refs, userId),
          hireDate: hireDates.get(userId) ?? null,
          current: current ? profileVersionDto(current, refs) : null,
          versions: mine.map((v) => profileVersionDto(v, refs)),
        };
      })
      .sort(
        (a, b) =>
          a.user.fullName.localeCompare(b.user.fullName, 'vi') || (a.userId < b.userId ? -1 : 1),
      );
  }

  /** `POST payroll/salary-profiles/:userId` ⇒ phiên bản mới (chỉ thêm); trùng tháng ⇒ 409. */
  async createVersion(
    actorId: string,
    q: { userId: string; effectiveFrom: string; level: string; baseSalary: number },
  ): Promise<SalaryProfileVersionDto> {
    const { d } = this;
    const record = {
      id: d.ids.next(),
      userId: q.userId,
      effectiveFrom: q.effectiveFrom,
      level: q.level,
      baseSalary: q.baseSalary,
      createdById: actorId,
      createdAt: d.clock.now(),
    };
    await d.uow.run(async () => {
      await d.access.authorizeWrite({ actorId, targetUserId: q.userId });
      if ((await d.store.insertProfile(record)) === 'duplicate') {
        throw new ResourceConflictError(
          { reason: 'salary_profile_exists', field: 'effectiveFrom' },
          'Đã có phiên bản hồ sơ lương cho tháng này.',
        );
      }
      await d.audit.record({
        actorId,
        action: 'PAYROLL_SALARY_SET',
        targetUserId: q.userId,
        refId: record.id,
        after: { effectiveFrom: q.effectiveFrom, level: q.level, baseSalary: q.baseSalary },
      });
    });
    return profileVersionDto(record, await d.users.findRefs([actorId]));
  }
}
