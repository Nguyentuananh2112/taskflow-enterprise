import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { HalfDays } from '../../domain/leave-days';
import type { LeaveTenure } from '../../domain/leave-tenure';
import { refOf, toBalanceDto, type LeaveBalanceRowDto } from '../leave-dto';
import { countingTenure, yearOf, type LeaveKit, type LeaveScope } from '../leave-kit';

export interface AdjustBalanceInput {
  userId: string;
  year: number;
  /** GIÁ TRỊ MỚI tuyệt đối (không phải delta), nửa ngày, có thể âm (Q4 — TL chốt (a): kể cả remaining − pending < 0). */
  adjustment: HalfDays;
  note?: string | null;
}

/**
 * PATCH leave/balances/:userId/:year (LB-04..08; company-level ADR-136 D M3). Thứ tự: chốt ghi HR (401 / 403 quyền /
 * 403 tự chỉnh — tuyệt đối) → năm ngoài ±1 400 → người CHƯA TỪNG có nhiệm kỳ EMPLOYEE giao năm đó 404 → khóa
 * `taskflow:leave:<user>` (bậc 3) → chốt ghi HR LẦN NỮA trong khóa (bậc 5, B-H3). Trả dòng số dư mới (H).
 */
export class AdjustBalanceUseCase {
  constructor(private readonly kit: LeaveKit) {}

  async execute(scope: LeaveScope, input: AdjustBalanceInput): Promise<LeaveBalanceRowDto> {
    const { actorId } = scope;
    const d = this.kit.d;
    const note = input.note ?? null;
    const guard = { actorId, targetUserId: input.userId, reason: note };
    // Lần 1 NGOÀI transaction: CHỈ để thất bại sớm (403 trước 400 năm, 404 user) — FOR SHARE ở đây không giữ khóa
    // nào. Lần chốt là lần thứ hai, trong `uow.run` sau `lockUser` (B review LOW-1).
    await d.company.authorizeHrWrite(guard);
    const currentYear = yearOf(await this.kit.today());
    if (Math.abs(input.year - currentYear) > 1) {
      throw new ValidationError([
        {
          path: ['year'],
          code: 'too_big',
          message: 'Chỉ chỉnh số dư trong khoảng ±1 năm so với năm hiện tại.',
        },
      ]);
    }
    const yearTenure = await this.tenureForYear(input.userId, input.year);
    if (yearTenure === undefined) throw new ResourceNotFoundError('user');

    const today = await this.kit.today();
    const view = await d.uow.run(async () => {
      await this.kit.lockFor(input.userId); // policy SHARED → leave:<user> (ADR-131/136)
      await d.company.authorizeHrWrite(guard); // B-H3: sau khóa
      const before = await d.requests.getOrCreateBalance(input.userId, input.year);
      await d.requests.setBalanceAdjustment(input.userId, input.year, input.adjustment);
      await d.audit.record({
        actorId,
        action: 'BALANCE_ADJUST',
        targetUserId: input.userId,
        refId: null,
        before: { year: input.year, adjustmentHalfDays: before.adjustment },
        after: { year: input.year, adjustmentHalfDays: input.adjustment },
        note,
      });
      await this.kit.snapshotCarried(input.userId, input.year, today);
      // Chỉnh năm Y khi Y+1 đã bắt đầu ⇒ `carried(Y+1)` đã chụp phải tính lại (ADR-131, LP-09).
      await this.kit.refreshNextCarried(input.userId, input.year, today);
      return this.kit.calculator().compute({
        userId: input.userId,
        year: input.year,
        today,
        tenure: yearTenure,
      });
    });
    const refs = await d.users.findRefs([input.userId]);
    return {
      userId: input.userId,
      user: refOf(refs, input.userId),
      ...toBalanceDto(view),
    };
  }

  /**
   * Nhiệm kỳ để đếm số dư năm Y: nhiệm kỳ hiện tại (cắt ở `lastDay` nếu đã có lịch nghỉ) nếu nó giao năm Y, không
   * thì nhiệm kỳ cuối cùng giao năm Y (người đã nghỉ — R30). Không nhiệm kỳ nào giao Y ⇒ `undefined` (404).
   */
  private async tenureForYear(userId: string, year: number): Promise<LeaveTenure | undefined> {
    const from = `${String(year)}-01-01`;
    const to = `${String(year)}-12-31`;
    const counting = countingTenure(await this.kit.d.company.employmentOf(userId));
    if (
      counting !== null &&
      counting.from <= to &&
      (counting.until === null || counting.until >= from)
    ) {
      return counting;
    }
    const tenures =
      (await this.kit.d.company.tenuresOf({ userIds: [userId], from, to })).get(userId) ?? [];
    return tenures.reduce<LeaveTenure | undefined>(
      (last, t) => (last === undefined || t.from > last.from ? t : last),
      undefined,
    );
  }
}
