import type { UserRefDto } from '@taskflow/contracts/auth';
import {
  completedYears,
  computePayslip,
  periodLastDay,
  seniorityAllowanceOf,
  type PayslipDto,
  type PayslipLineInput,
  type PublishBlockReason,
  type SalaryProfileVersionDto,
} from '@taskflow/contracts/payroll';

import { COMPANY_SCOPE } from './mock-guard';
import type { MockHr } from './mock-hr';
import { daysOf, workday } from './payroll-days';

// Phiếu lương (payroll.md v4, contract T-048) — bản RÚT GỌN: công = 2 nửa mỗi ngày Có mặt / lễ ngày làm (phép có
// lương không mô phỏng), công chuẩn = số ngày T2–T7 của tháng. Tiền tính bằng CHÍNH `computePayslip` của contracts.

export type MockPayslip = PayslipDto & { userRef: UserRefDto };
export type MockRun = {
  period: string;
  status: 'DRAFT' | 'PUBLISHED';
  standardDays: number;
  seniorityPerYear: number;
  publishedAt: string | null;
  publishedBy: UserRefDto | null;
  /** userId ⇒ các bản (revision tăng dần); bản cuối là bản hiệu lực. */
  slips: Map<string, MockPayslip[]>;
};

export class MockPayroll {
  settings = {
    seniorityPerYear: 500_000,
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: null as UserRefDto | null,
  };
  readonly profiles = new Map<string, SalaryProfileVersionDto[]>();
  readonly runs = new Map<string, MockRun>();
  /** Ngày vào công ty (hồ sơ nhân viên — ADR-128). Nhánh Mốc 4 chưa có hồ sơ ⇒ test / index nối vào. */
  hireDateOf: (userId: string) => string | null = () => null;
  constructor(private readonly hr: MockHr) {}

  #iso = () => new Date(this.hr.db.now()).toISOString();

  /** Phiên bản hồ sơ lương áp cho kỳ (effectiveFrom ≤ kỳ, mới nhất). */
  profileFor(userId: string, period: string) {
    return (this.profiles.get(userId) ?? [])
      .filter((v) => v.effectiveFrom <= period)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  }

  standardDays = (period: string) => daysOf(period).filter(workday).length;

  paidHalfDays(userId: string, period: string): number {
    return daysOf(period).reduce((n, d) => {
      const s = this.hr.day(COMPANY_SCOPE, userId, d).status;
      return n + (s === 'PRESENT' || (s === 'HOLIDAY' && workday(d)) ? 2 : 0);
    }, 0);
  }

  /** Dựng / tính lại một phiếu nháp từ hồ sơ + công + dòng gõ tay. */
  build(
    run: MockRun,
    user: UserRefDto,
    edit: Partial<Pick<MockPayslip, 'note' | 'overrideHalfDays' | 'overrideReason'>> & {
      lines?: PayslipLineInput[];
      revision?: number;
      /** Bản điều chỉnh copy công của bản trước (ADR-127). */
      paidHalfDays?: number;
      lockVersion?: number;
    } = {},
  ): MockPayslip {
    const profile = this.profileFor(user.id, run.period);
    const hireDate = this.hireDateOf(user.id);
    const years = hireDate ? (completedYears(hireDate, periodLastDay(run.period)) ?? 0) : 0;
    const seniorityAllowance = seniorityAllowanceOf(run.seniorityPerYear, years);
    const paidHalfDays = edit.paidHalfDays ?? this.paidHalfDays(user.id, run.period);
    const overrideHalfDays = edit.overrideHalfDays ?? null;
    const lines = (edit.lines ?? []).map((l) => ({ ...l, id: crypto.randomUUID() }));
    const totals = computePayslip({
      baseSalary: profile?.baseSalary ?? 0,
      paidHalfDays: overrideHalfDays ?? paidHalfDays,
      standardDays: run.standardDays,
      seniorityAllowance,
      lines,
    });
    return {
      period: run.period,
      userId: user.id,
      userRef: user,
      fullName: user.fullName,
      companyName: run.status === 'PUBLISHED' ? this.hr.db.company.name : null,
      status: run.status,
      revision: edit.revision ?? 1,
      lockVersion: edit.lockVersion ?? 1,
      level: profile?.level ?? null,
      baseSalary: profile?.baseSalary ?? null,
      hireDate,
      seniorityYears: years,
      seniorityPerYear: run.seniorityPerYear,
      paidHalfDays,
      standardDays: run.standardDays,
      overrideHalfDays,
      overrideReason: edit.overrideReason ?? null,
      lines,
      note: edit.note ?? null,
      ...totals,
      revisionReason: null,
      revisedAt: null,
      supersededAt: null,
      publishedAt: run.publishedAt,
      hasSickDays: false,
    };
  }

  /** Người trong kỳ: nhân viên (role EMPLOYEE) hiện có — mock không mô phỏng nhiệm kỳ cắt giữa tháng. */
  people(): UserRefDto[] {
    return this.hr.db.company
      .members()
      .filter(([, r]) => r.role === 'EMPLOYEE')
      .flatMap(([id]) => {
        const u = this.hr.db.getUser(id);
        return u ? [{ id, fullName: u.fullName }] : [];
      });
  }

  createRun(period: string): MockRun {
    const existing = this.runs.get(period);
    if (existing) return existing;
    const run: MockRun = {
      period,
      status: 'DRAFT',
      standardDays: Math.max(1, this.standardDays(period)),
      seniorityPerYear: this.settings.seniorityPerYear,
      publishedAt: null,
      publishedBy: null,
      slips: new Map(),
    };
    for (const u of this.people()) run.slips.set(u.id, [this.build(run, u)]);
    this.runs.set(period, run);
    return run;
  }

  current = (run: MockRun, userId: string) => run.slips.get(userId)?.at(-1);

  /** Lý do chặn phát hành (ADR-125, TL 18/10) — chỉ trên NHÁP; MISSING_OUT không chặn. */
  blockReasons(run: MockRun, s: MockPayslip): PublishBlockReason[] {
    if (run.status !== 'DRAFT') return [];
    const out: PublishBlockReason[] = [];
    if (s.netPay < 0) out.push('NEGATIVE_NET_PAY');
    if (s.baseSalary === null) out.push('MISSING_SALARY_PROFILE');
    if (s.hireDate === null) out.push('MISSING_HIRE_DATE');
    else if (s.hireDate > periodLastDay(run.period)) out.push('HIRE_DATE_AFTER_PERIOD');
    if (run.seniorityPerYear !== this.settings.seniorityPerYear) out.push('SENIORITY_RATE_CHANGED');
    return out;
  }

  /** Ngày quên chấm ra trong kỳ (việc còn lại / cảnh báo modal). */
  missingOut(userId: string, period: string): string[] {
    return daysOf(period).filter(
      (d) => this.hr.day(COMPANY_SCOPE, userId, d).status === 'MISSING_OUT',
    );
  }

  publish(run: MockRun, by: UserRefDto): void {
    run.status = 'PUBLISHED';
    run.publishedAt = this.#iso();
    run.publishedBy = by;
    for (const list of run.slips.values()) {
      for (const s of list)
        Object.assign(s, {
          status: 'PUBLISHED',
          publishedAt: run.publishedAt,
          companyName: this.hr.db.company.name,
        });
    }
  }

  /** Bản điều chỉnh: bản cũ `supersededAt`, bản mới revision + 1 có lý do (nhân viên xem được). */
  revise(run: MockRun, user: UserRefDto, next: MockPayslip, reason: string): MockPayslip {
    const list = run.slips.get(user.id) ?? [];
    const prev = list.at(-1);
    if (prev) prev.supersededAt = this.#iso();
    const slip = {
      ...next,
      status: 'PUBLISHED' as const,
      revision: (prev?.revision ?? 0) + 1,
      revisionReason: reason,
      revisedAt: this.#iso(),
      publishedAt: run.publishedAt,
      companyName: this.hr.db.company.name,
    };
    run.slips.set(user.id, [...list, slip]);
    return slip;
  }
}
