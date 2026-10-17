import { consumesAnnualBalance } from '../domain/leave-balance';
import type { CalendarDate, HalfDays, LeaveSpan } from '../domain/leave-days';
import {
  annualBalance,
  carriedOverOf,
  carryOverExpiresOn,
  continuousInto,
  entitlementOf,
  resolvePolicy,
  splitAtExpiry,
  type AnnualBalance,
  type Entitlement,
  type LeavePolicy,
  type ResolvedPolicy,
} from '../domain/leave-policy';
import { belongsToTenure, countTenureHalfDays, type LeaveTenure } from '../domain/leave-tenure';
import type {
  ILeaveCompany,
  ILeaveHireDates,
  ILeavePolicyStore,
  LeaveBalanceRecord,
  LeaveRequestRecord,
  WorkCalendarDay,
} from './ports/leave.ports';

/**
 * Nguồn dữ liệu cho một lượt tính số dư — đường GHI truyền repo (trong khóa), đường ĐỌC truyền read model (không
 * tạo dòng). Hàm thuần nằm ở domain/leave-policy.ts; đây chỉ gom dữ liệu + cache theo lượt (ADR-131).
 */
export interface BalanceSources {
  policies: Pick<ILeavePolicyStore, 'list'>;
  hireDates: ILeaveHireDates;
  company: Pick<ILeaveCompany, 'tenuresOf'>;
  holdingOf(userId: string, year: number): Promise<LeaveRequestRecord[]>;
  storedOf(userId: string, year: number): Promise<LeaveBalanceRecord | null>;
  calendarOf(year: number): Promise<WorkCalendarDay[]>;
}

export interface BalanceView {
  year: number;
  entitlement: Entitlement;
  adjustment: HalfDays;
  carried: HalfDays;
  /** `false` ⇒ chưa chụp, số `carried` là tính tạm (GET không ghi). */
  carriedFinal: boolean;
  /** `null` khi không có phép chuyển sang. */
  expiresOn: CalendarDate | null;
  /** Hiển thị: đơn APPROVED / PENDING ANNUAL của nhiệm kỳ (PENDING trừ `excludeId`). */
  used: HalfDays;
  pending: HalfDays;
  balance: AnnualBalance;
}

const OPEN: LeaveTenure = { from: '0000-01-01', until: null };

export class AnnualBalanceCalculator {
  #policies: Promise<{ year: number; policy: LeavePolicy }[]> | undefined;
  readonly #calendars = new Map<number, Promise<WorkCalendarDay[]>>();

  constructor(private readonly s: BalanceSources) {}

  async policyFor(year: number): Promise<ResolvedPolicy> {
    this.#policies ??= this.s.policies.list();
    return resolvePolicy(await this.#policies, year);
  }

  calendar(year: number): Promise<WorkCalendarDay[]> {
    let c = this.#calendars.get(year);
    if (!c) {
      c = this.s.calendarOf(year);
      this.#calendars.set(year, c);
    }
    return c;
  }

  /**
   * Số dư năm `year` của người đó tại `today`. `tenure` = nhiệm kỳ dùng để đếm (null ⇒ không giao năm ⇒ entitled 0,
   * vẫn đếm mọi đơn). `extra` = đơn đang xét chưa lưu (submit / preview); `excludeId` = đơn đang duyệt.
   */
  async compute(input: {
    userId: string;
    year: number;
    today: CalendarDate;
    tenure: LeaveTenure | null;
    holding?: readonly LeaveRequestRecord[];
    stored?: LeaveBalanceRecord | null;
    excludeId?: string;
    extra?: LeaveSpan & { type: LeaveRequestRecord['type'] };
  }): Promise<BalanceView> {
    const { userId, year, tenure } = input;
    const [resolved, hireDate, stored, holding, calendar] = await Promise.all([
      this.policyFor(year),
      this.s.hireDates.hireDateOf(userId),
      input.stored === undefined ? this.s.storedOf(userId, year) : Promise.resolve(input.stored),
      input.holding ? Promise.resolve(input.holding) : this.s.holdingOf(userId, year),
      this.calendar(year),
    ]);
    const entitlement = entitlementOf({
      policy: resolved.policy,
      year,
      hireDate,
      tenure,
      override: stored?.entitled ?? null,
    });
    const snapped = stored?.carried ?? null;
    const carriedFinal = snapped !== null;
    const carried = snapped ?? (await this.carriedInto(userId, year, hireDate));
    const expiresOn = carryOverExpiresOn(
      year,
      (await this.policyFor(year - 1)).policy.carryOverExpiryMonth,
    );

    const count = tenure ?? OPEN;
    let used = 0;
    let pending = 0;
    let early = 0;
    let late = 0;
    const consider = (span: LeaveSpan, status: 'APPROVED' | 'PENDING' | 'NEW') => {
      const half = countTenureHalfDays(span, calendar, count);
      if (status === 'APPROVED') used += half;
      else if (status === 'PENDING') pending += half;
      const split = splitAtExpiry(span, calendar, count, expiresOn);
      early += split.early;
      late += split.late;
    };
    for (const r of holding) {
      if (!consumesAnnualBalance(r.type) || r.id === input.excludeId) continue;
      if (tenure !== null && !belongsToTenure(r, tenure)) continue;
      if (r.status === 'APPROVED' || r.status === 'PENDING') consider(r, r.status);
    }
    if (input.extra && consumesAnnualBalance(input.extra.type)) consider(input.extra, 'NEW');
    const balance = annualBalance({
      entitled: entitlement.entitled,
      adjustment: stored?.adjustment ?? 0,
      carried,
      usedEarly: early,
      usedLate: late,
      today: input.today,
      expiresOn,
    });
    return {
      year,
      entitlement,
      adjustment: stored?.adjustment ?? 0,
      carried,
      carriedFinal,
      expiresOn: carried > 0 ? expiresOn : null,
      used,
      pending,
      balance,
    };
  }

  /**
   * `carried(year)` (ADR-131): liên tục qua 31/12/(year−1) → 01/01/year + năm trước bật chuyển ⇒ min(trần, còn lại cuối
   * năm trước — CHỈ đơn APPROVED của nhiệm kỳ đó, không cộng phép chuyển sang của năm trước: không chuyển tiếp lần 2).
   */
  async carriedInto(
    userId: string,
    year: number,
    hireDate?: CalendarDate | null,
  ): Promise<HalfDays> {
    const prev = year - 1;
    const previous = await this.policyFor(prev);
    if (!previous.policy.carryOverEnabled) return 0;
    const map = await this.s.company.tenuresOf({
      userIds: [userId],
      from: `${String(prev)}-12-31`,
      to: `${String(year)}-01-01`,
    });
    const tenures = map.get(userId) ?? [];
    if (!continuousInto(tenures, year)) return 0;
    const spanning = tenures.find(
      (t) =>
        t.from <= `${String(prev)}-12-31` &&
        (t.until === null || t.until >= `${String(year)}-01-01`),
    )!;
    const [stored, holding, calendar, hire] = await Promise.all([
      this.s.storedOf(userId, prev),
      this.s.holdingOf(userId, prev),
      this.calendar(prev),
      hireDate === undefined ? this.s.hireDates.hireDateOf(userId) : Promise.resolve(hireDate),
    ]);
    const entitled = entitlementOf({
      policy: previous.policy,
      year: prev,
      hireDate: hire,
      tenure: spanning,
      override: stored?.entitled ?? null,
    }).entitled;
    let approved = 0;
    for (const r of holding) {
      if (
        r.status !== 'APPROVED' ||
        !consumesAnnualBalance(r.type) ||
        !belongsToTenure(r, spanning)
      ) {
        continue;
      }
      approved += countTenureHalfDays(r, calendar, spanning);
    }
    return carriedOverOf({
      previousPolicy: previous.policy,
      continuous: true,
      remainingAtYearEnd: entitled + (stored?.adjustment ?? 0) - approved,
    });
  }
}
