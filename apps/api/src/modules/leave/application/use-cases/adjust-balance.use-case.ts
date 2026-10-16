import { ResourceNotFoundError, ValidationError } from '../../../../core/errors';
import type { HalfDays } from '../../domain/leave-days';
import { PERMISSION_HR_MANAGE, yearOf, type LeaveKit, type LeaveScope } from '../leave-kit';

export interface AdjustBalanceInput {
  userId: string;
  year: number;
  /** Nửa ngày, có thể âm (Q4: số dư được phép âm khi đã có đơn APPROVED). */
  adjustment: HalfDays;
  note?: string | null;
}

/**
 * PATCH leave-balances/:userId/:year (test-spec LB-04..08). Thứ tự: thiếu quyền / tự chỉnh 403 → năm ngoài ±1
 * 400 → userId chưa từng có dữ liệu 404 → khóa (ws, user) cùng khóa với đơn nghỉ (D-H2) → đọc lại quyền (B-H3).
 */
export class AdjustBalanceUseCase {
  constructor(private readonly kit: LeaveKit) {}

  async execute(scope: LeaveScope, input: AdjustBalanceInput): Promise<void> {
    const { workspaceId, actorId } = scope;
    const d = this.kit.d;
    const note = input.note ?? null;
    const actor = await this.kit.requireActor(workspaceId, actorId, PERMISSION_HR_MANAGE);
    this.kit.assertNotSelf(actor, input.userId, note);
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

    await d.uow.run(async () => {
      await d.requests.lockUser(workspaceId, input.userId);
      await this.kit.requireActor(workspaceId, actorId, PERMISSION_HR_MANAGE); // B-H3
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
    });
  }
}
