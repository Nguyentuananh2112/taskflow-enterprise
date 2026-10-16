import type { LeaveRequestDto } from './leave-dto';
import { LeaveKit, type LeaveCommandDeps, type LeaveScope } from './leave-kit';
import { AdjustBalanceUseCase, type AdjustBalanceInput } from './use-cases/adjust-balance.use-case';
import { CancelLeaveUseCase } from './use-cases/cancel-leave.use-case';
import { DecideLeaveUseCase } from './use-cases/decide-leave.use-case';
import { SubmitLeaveUseCase, type SubmitLeaveInput } from './use-cases/submit-leave.use-case';

export { PERMISSION_HR_MANAGE, PERMISSION_LEAVE_SELF, type LeaveCommandDeps } from './leave-kit';
export type { SubmitLeaveInput } from './use-cases/submit-leave.use-case';

/**
 * Mặt tiền các lệnh leave (thiết kế §2 ADR-122, §9) cho controller + test A. Mỗi lệnh là một use case riêng
 * (max-lines), dùng chung `LeaveKit`. Thông báo + audit ghi trong CÙNG transaction với thay đổi (ADR-123).
 */
export class LeaveCommands {
  readonly #submit: SubmitLeaveUseCase;
  readonly #decide: DecideLeaveUseCase;
  readonly #cancel: CancelLeaveUseCase;
  readonly #adjust: AdjustBalanceUseCase;

  constructor(deps: LeaveCommandDeps) {
    const kit = new LeaveKit(deps);
    this.#submit = new SubmitLeaveUseCase(kit);
    this.#decide = new DecideLeaveUseCase(kit);
    this.#cancel = new CancelLeaveUseCase(kit);
    this.#adjust = new AdjustBalanceUseCase(kit);
  }

  submit(scope: LeaveScope, input: SubmitLeaveInput): Promise<LeaveRequestDto> {
    return this.#submit.execute(scope, input);
  }

  approve(
    scope: LeaveScope,
    requestId: string,
    expectedVersion: number,
    note: string | null = null,
  ) {
    return this.#decide.execute(scope, { requestId, expectedVersion, action: 'approve', note });
  }

  reject(
    scope: LeaveScope,
    requestId: string,
    expectedVersion: number,
    note: string | null = null,
  ) {
    return this.#decide.execute(scope, { requestId, expectedVersion, action: 'reject', note });
  }

  /** LV-19/20: lý do bắt buộc (400). Chỉ trước ngày bắt đầu (domain). */
  revoke(scope: LeaveScope, requestId: string, expectedVersion: number, note: string) {
    return this.#decide.execute(scope, { requestId, expectedVersion, action: 'revoke', note });
  }

  cancel(scope: LeaveScope, requestId: string, expectedVersion: number): Promise<LeaveRequestDto> {
    return this.#cancel.execute(scope, { requestId, expectedVersion });
  }

  adjustBalance(scope: LeaveScope, input: AdjustBalanceInput): Promise<void> {
    return this.#adjust.execute(scope, input);
  }
}
