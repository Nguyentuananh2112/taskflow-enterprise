import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { HalfDays } from '../../domain/leave-days';
import { refOf, toBalanceDto, type LeaveBalanceRowDto } from '../leave-dto';
import { summarizeStored, yearOf, type LeaveKit, type LeaveScope } from '../leave-kit';

export interface AdjustBalanceInput {
  userId: string;
  year: number;
  /** GIÁ TRỊ MỚI tuyệt đối (không phải delta), nửa ngày, có thể âm (Q4 — TL chốt (a): kể cả remaining − pending < 0). */
  adjustment: HalfDays;
  note?: string | null;
}

/**
 * PATCH leave-balances/:userId/:year (test-spec LB-04..08). Thứ tự: chốt ghi HR (404 ws / 403 quyền / 403 tự
 * chỉnh / 422 OWNER thiếu lý do) → năm ngoài ±1 400 → userId chưa từng có dữ liệu 404 → khóa (ws, user) cùng khóa
 * với đơn nghỉ (D-H2) → chốt ghi HR LẦN NỮA trong khóa (B-H3). Trả dòng số dư mới để web cập nhật một dòng (H).
 */
export class AdjustBalanceUseCase {
  constructor(private readonly kit: LeaveKit) {}

  async execute(scope: LeaveScope, input: AdjustBalanceInput): Promise<LeaveBalanceRowDto> {
    const { workspaceId, actorId } = scope;
    const d = this.kit.d;
    const note = input.note ?? null;
    const guard = { workspaceId, actorId, targetUserId: input.userId, reason: note };
    // Lần 1 NGOÀI transaction: CHỈ để thất bại sớm (403 / 422 trước 400 năm, 404 user) — FOR SHARE ở đây không giữ
    // khóa nào. Lần chốt là lần thứ hai, trong `uow.run` sau `lockUser` (B review LOW-1).
    await d.membership.authorizeHrWrite(guard);
    const currentYear = yearOf(await this.kit.today(workspaceId));
    if (Math.abs(input.year - currentYear) > 1) {
      throw new ValidationError([
        {
          path: ['year'],
          code: 'too_big',
          message: 'Chỉ chỉnh số dư trong khoảng ±1 năm so với năm hiện tại.',
        },
      ]);
    }
    // LB-06: thành viên hiện tại (kể cả chưa có đơn — người mới) hoặc người đã rời còn lịch sử; còn lại 404.
    if (
      !(await d.membership.isEligibleRequester(workspaceId, input.userId)) &&
      !(await d.requests.hasHistory(workspaceId, input.userId))
    ) {
      throw new ResourceNotFoundError('user');
    }

    const balance = await d.uow.run(async () => {
      await d.requests.lockUser(workspaceId, input.userId);
      await d.membership.authorizeHrWrite(guard); // B-H3: sau khóa
      const before = await d.requests.getOrCreateBalance(workspaceId, input.userId, input.year);
      await d.requests.setBalanceAdjustment(
        workspaceId,
        input.userId,
        input.year,
        input.adjustment,
      );
      await d.audit.record({
        workspaceId,
        actorId,
        action: 'BALANCE_ADJUST',
        targetUserId: input.userId,
        refId: null,
        before: { year: input.year, adjustmentHalfDays: before.adjustment },
        after: { year: input.year, adjustmentHalfDays: input.adjustment },
        note,
      });
      return summarizeStored(
        { entitled: before.entitled, adjustment: input.adjustment },
        await d.requests.listHolding(workspaceId, input.userId, input.year),
        await this.kit.yearCalendar(workspaceId, input.year),
      );
    });
    const refs = await d.users.findRefs([input.userId]);
    return {
      userId: input.userId,
      user: refOf(refs, input.userId),
      ...toBalanceDto(input.year, balance),
    };
  }
}
