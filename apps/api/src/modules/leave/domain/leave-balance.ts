import { BusinessRuleViolationError } from '../../../core/errors';
import type { HalfDays } from './leave-days';
import { type LeaveStatus } from './leave-status';

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL_PAID', 'UNPAID', 'OTHER'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

/** Phép năm mặc định 12 ngày (ADR-122) = 24 nửa ngày. Người vào giữa năm: HR chỉnh `adjustment` (thiết kế §9). */
export const DEFAULT_ENTITLED_HALF_DAYS: HalfDays = 24;

/** Chỉ ANNUAL trừ phép năm (LB-03). */
export function consumesAnnualBalance(type: LeaveType): boolean {
  return type === 'ANNUAL';
}

export interface BalanceRequest {
  readonly id: string;
  readonly type: LeaveType;
  readonly status: LeaveStatus;
  /** Số nửa ngày TÍNH KHI ĐỌC theo lịch hiện tại (D-H3a). */
  readonly halfDays: HalfDays;
}

export interface BalanceSummary {
  readonly entitled: HalfDays;
  readonly adjustment: HalfDays;
  readonly used: HalfDays;
  readonly pending: HalfDays;
  /** Có thể ÂM (Q4: HR giảm adjustment khi đã có đơn APPROVED) — hiển thị âm, chặn đơn ANNUAL mới. */
  readonly remaining: HalfDays;
}

/**
 * Công thức số dư (thiết kế §2 ADR-122 + §9, LB-02): `entitled + adjustment − used − pending_khác`.
 * `used` = đơn APPROVED loại ANNUAL; `pending` = đơn PENDING loại ANNUAL **trừ đơn `excludeId`** (chính đơn
 * đang xét khi duyệt — nếu không, đơn vừa đủ số dư luôn bị 422). Gọi bên TRONG khóa `taskflow:leave:<ws>:<user>`.
 */
export function summarizeBalance(input: {
  entitled: HalfDays;
  adjustment: HalfDays;
  requests: readonly BalanceRequest[];
  excludeId?: string;
}): BalanceSummary {
  let used = 0;
  let pending = 0;
  for (const r of input.requests) {
    if (r.id === input.excludeId || !consumesAnnualBalance(r.type)) continue;
    if (r.status === 'APPROVED') used += r.halfDays;
    else if (r.status === 'PENDING') pending += r.halfDays;
  }
  return {
    entitled: input.entitled,
    adjustment: input.adjustment,
    used,
    pending,
    remaining: input.entitled + input.adjustment - used - pending,
  };
}

/** 422 `insufficient_balance` khi đơn ANNUAL xin nhiều hơn số còn (kiểm cả lúc GỬI lẫn lúc DUYỆT — D-H2). */
export function assertBalanceCovers(
  type: LeaveType,
  requested: HalfDays,
  balance: BalanceSummary,
): void {
  if (!consumesAnnualBalance(type) || requested <= balance.remaining) return;
  throw new BusinessRuleViolationError(
    'insufficient_balance',
    'Không đủ số ngày phép năm còn lại.',
    {
      remainingDays: halfDaysToDecimal(balance.remaining),
      requestedDays: halfDaysToDecimal(requested),
    },
  );
}

/** Biên DB/DTO (LB-09): `Decimal(4,1)` (Prisma trả chuỗi/Decimal) ⇒ nửa ngày. Không phải bội 0,5 ⇒ dữ liệu hỏng. */
export function halfDaysFromDecimal(value: string | number | { toString(): string }): HalfDays {
  const doubled = Number(value.toString()) * 2;
  if (!Number.isInteger(doubled)) {
    throw new Error(`Số ngày phép phải là bội 0,5 — nhận ${value.toString()}`);
  }
  return doubled;
}

/** Nửa ngày ⇒ số ngày thập phân cho DTO/DB. Luôn chính xác vì x/2 với x nguyên biểu diễn đúng trong IEEE-754. */
export function halfDaysToDecimal(halfDays: HalfDays): number {
  return halfDays / 2;
}
