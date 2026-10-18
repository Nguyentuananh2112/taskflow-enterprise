import type * as z from 'zod';

import type { LeaveRequestDto } from '@taskflow/contracts/leave';

import type { MockAttendance } from './mock-attendance';
import { MockPolicies, endOfMonth, yearsAtEndOf } from './mock-policy';
import type { CompanyContext } from './mock-guard';
import { fail } from './respond';

// Kho đơn nghỉ giả + luật kiểm đơn dùng chung cho gửi và xem trước (leave-handlers.ts).

export type Leave = z.infer<typeof LeaveRequestDto> & { workspaceId: string };

const dayList = (start: string, end: string) => {
  const out: string[] = [];
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t <= Date.parse(`${end}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};
const isWorkday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0;
const live = (l: Leave) => l.status === 'PENDING' || l.status === 'APPROVED';
const halves = (l: Pick<Leave, 'dayPart'>) => (l.dayPart === 'FULL' ? ['AM', 'PM'] : [l.dayPart]);

export class MockLeave {
  items: Leave[] = [];
  /** HR chỉnh số dư (T-041c): `adjustmentDays` tuyệt đối theo `${ws}|${user}|${year}`. */
  adjustments = new Map<string, number>();
  /** Chính sách phép theo năm (Mốc 5, ADR-131). */
  readonly policies = new MockPolicies(() => this.today());
  /** Ngày vào công ty (hồ sơ — ADR-128); index nối vào `db.company.profiles`. */
  hireDateOf: (userId: string) => string | null = () => null;
  constructor(
    private readonly attendance: MockAttendance,
    private readonly now: () => number,
  ) {}

  balance(wsId: string, userId: string, year: number) {
    const own = this.#own(wsId, userId, year);
    const p = this.policies.fields(year);
    const hire = this.hireDateOf(userId);
    const seniorityYears = hire ? yearsAtEndOf(hire, year) : null;
    const bonus =
      seniorityYears === null
        ? 0
        : p.seniorityBonusDays * Math.floor(seniorityYears / p.seniorityStepYears);
    const entitledDays = p.annualDays + bonus;
    // Phép chuyển sang (ADR-131, rút gọn): theo chính sách năm trước, trần, không chuyển tiếp lần 2; dùng trước hết
    // tháng hạn — mock coi mọi ngày đã dùng là "trước hạn" nếu đơn bắt đầu ≤ hạn.
    const prev = this.policies.fields(year - 1);
    const before = this.#own(wsId, userId, year - 1);
    const carriedOverDays = prev.carryOverEnabled
      ? Math.min(prev.carryOverMaxDays, Math.max(0, before.remainingDays))
      : 0;
    const expires = carriedOverDays > 0 ? endOfMonth(year, prev.carryOverExpiryMonth) : null;
    const early = expires ? own.usedBy(expires) : 0;
    const late = own.usedDays - early;
    const usable = expires && this.today() <= expires ? Math.max(0, carriedOverDays - early) : 0;
    return {
      year,
      entitledDays,
      adjustmentDays: own.adjustmentDays,
      usedDays: own.usedDays,
      pendingDays: own.pendingDays,
      remainingDays:
        entitledDays + own.adjustmentDays - Math.max(0, early - carriedOverDays) - late + usable,
      baseDays: entitledDays,
      seniorityBonusDays: bonus,
      seniorityYears,
      entitledSource: 'POLICY' as const,
      missingHireDate: hire === null,
      carriedOverDays,
      carriedFinal: true,
      carriedExpiresOn: expires,
      carriedUsableDays: usable,
    };
  }

  /** Số liệu của riêng năm (không phép chuyển sang) — cũng là "còn lại cuối năm" để tính chuyển sang năm sau. */
  #own(wsId: string, userId: string, year: number) {
    const mine = this.items.filter(
      (l) =>
        l.workspaceId === wsId &&
        l.userId === userId &&
        l.type === 'ANNUAL' &&
        l.startDate.startsWith(String(year)),
    );
    const sum = (s: string) => mine.filter((l) => l.status === s).reduce((n, l) => n + l.days, 0);
    const usedDays = sum('APPROVED');
    const adjustmentDays = this.adjustments.get(`${wsId}|${userId}|${year}`) ?? 0;
    const p = this.policies.fields(year);
    return {
      usedDays,
      pendingDays: sum('PENDING'),
      adjustmentDays,
      remainingDays: p.annualDays + adjustmentDays - usedDays,
      usedBy: (date: string) =>
        mine
          .filter((l) => l.status === 'APPROVED' && l.startDate <= date)
          .reduce((n, l) => n + l.days, 0),
    };
  }

  /** HR duyệt (test/dev) — T-041c sẽ có route thật. */
  decide(id: string, status: 'APPROVED' | 'REJECTED', by: { id: string; fullName: string }) {
    const l = this.items.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, {
      status,
      decidedBy: by,
      decidedAt: new Date(this.now()).toISOString(),
      version: l.version + 1,
    });
  }

  today = () => this.attendance.today();
}

export const strip = ({ workspaceId: _w, ...dto }: Leave) => dto;
/** Mốc 3.5: Admin không xin nghỉ (không có `leave:self` — ADR-134). */
export const selfOnly = (ctx: CompanyContext) =>
  ctx.company.permissions.includes('leave:self')
    ? null
    : fail(403, 'FORBIDDEN_ACCESS', { required: 'leave:self' });
export const rule = (r: string) => fail(422, 'BUSINESS_RULE_VIOLATION', { rule: r });
export const conflict = (reason: string) => fail(409, 'RESOURCE_CONFLICT', { reason });

type Draft = Pick<Leave, 'type' | 'startDate' | 'endDate' | 'dayPart'>;

/**
 * Kiểm một đơn (gửi hoặc xem trước — cùng hàm đếm, cùng lỗi) theo thứ tự D chốt:
 * 422 LEAVE_SPANS_YEARS → 403 → 422 NO_WORKING_DAYS → 409 overlapping_leave → 422 INSUFFICIENT_BALANCE.
 */
export function evaluate(
  leave: MockLeave,
  ctx: CompanyContext,
  wsId: string,
  b: Draft,
): { response: Response; days?: never } | { days: number; response?: never } {
  if (b.startDate.slice(0, 4) !== b.endDate.slice(0, 4))
    return { response: rule('LEAVE_SPANS_YEARS') };
  const denied = selfOnly(ctx);
  if (denied) return { response: denied };
  const work = dayList(b.startDate, b.endDate).filter(isWorkday);
  if (work.length === 0) return { response: rule('NO_WORKING_DAYS') };
  const days = b.dayPart === 'FULL' ? work.length : 0.5;
  const userId = ctx.user.id;
  const clash = leave.items.find(
    (l) =>
      l.workspaceId === wsId &&
      l.userId === userId &&
      live(l) &&
      l.startDate <= b.endDate &&
      b.startDate <= l.endDate &&
      (l.startDate !== l.endDate ||
        b.startDate !== b.endDate ||
        halves(l).some((h) => halves(b).includes(h))),
  );
  if (clash) {
    return {
      response: fail(409, 'RESOURCE_CONFLICT', {
        reason: 'overlapping_leave',
        requestId: clash.id,
      }),
    };
  }
  if (b.type === 'ANNUAL') {
    const bal = leave.balance(wsId, userId, Number(b.startDate.slice(0, 4)));
    const left = bal.remainingDays - bal.pendingDays;
    if (left < days) {
      return {
        response: fail(422, 'BUSINESS_RULE_VIOLATION', {
          rule: 'INSUFFICIENT_BALANCE',
          remainingDays: left,
          requestedDays: days,
        }),
      };
    }
  }
  return { days };
}
