import {
  assertBalanceCovers,
  consumesAnnualBalance,
  DEFAULT_ENTITLED_HALF_DAYS,
  halfDaysToDecimal,
} from '../../domain/leave-balance';
import { assertLeaveRange, countLeaveHalfDays } from '../../domain/leave-days';
import { assertNotAfterLastDay } from '../../domain/leave-tenure';
import {
  PERMISSION_LEAVE_SELF,
  countingTenure,
  summarizeStored,
  yearOf,
  type LeaveKit,
  type LeaveScope,
} from '../leave-kit';
import type { ILeaveReadModel } from '../ports/leave-read-model.port';
import type { SubmitLeaveInput } from './submit-leave.use-case';
import { assertHasWorkingDays, assertNoOverlap } from './new-leave-checks';

export interface LeavePreviewDto {
  /** Số ngày đơn sẽ chiếm theo lịch hiện tại (thập phân bước 0,5). */
  days: number;
  /** Số dư phép năm CÒN LẠI trước đơn này (= `remainingDays` của `leave-balances/me`); khác ANNUAL ⇒ `null`. */
  remainingDays: number | null;
}

/**
 * `GET leave-requests/preview` (TL duyệt, thiết kế §5): cùng thứ tự kiểm như submit — 422 `NO_WORKING_DAYS` /
 * `LEAVE_SPANS_YEARS` / `INSUFFICIENT_BALANCE`, 409 `overlapping_leave` — nhưng KHÔNG khóa, KHÔNG ghi (kể cả
 * không tạo lười số dư). Kết quả chỉ là gợi ý cho form: submit vẫn kiểm lại trong khóa (D-H2).
 */
export class PreviewLeaveQuery {
  constructor(
    private readonly kit: LeaveKit,
    private readonly readModel: ILeaveReadModel,
  ) {}

  async execute(
    scope: LeaveScope,
    input: Omit<SubmitLeaveInput, 'reason'>,
  ): Promise<LeavePreviewDto> {
    const { actorId } = scope;
    await this.kit.requireActor(actorId, PERMISSION_LEAVE_SELF);
    assertLeaveRange(input);
    const employment = await this.kit.d.company.employmentOf(actorId);
    assertNotAfterLastDay(input, employment.lastDay);

    const year = yearOf(input.startDate);
    const calendar = await this.kit.yearCalendar(year);
    const halfDays = countLeaveHalfDays(input, calendar);
    assertHasWorkingDays(halfDays);

    const holding = await this.kit.d.requests.listHolding(actorId, year);
    assertNoOverlap(holding, input);
    if (!consumesAnnualBalance(input.type)) {
      return { days: halfDaysToDecimal(halfDays), remainingDays: null };
    }
    const stored = await this.readModel.findBalance(actorId, year);
    const balance = summarizeStored(
      stored ?? { entitled: DEFAULT_ENTITLED_HALF_DAYS, adjustment: 0 },
      holding,
      calendar,
      { tenure: countingTenure(employment) },
    );
    assertBalanceCovers(input.type, halfDays, balance);
    return {
      days: halfDaysToDecimal(halfDays),
      remainingDays: halfDaysToDecimal(balance.remaining),
    };
  }
}
