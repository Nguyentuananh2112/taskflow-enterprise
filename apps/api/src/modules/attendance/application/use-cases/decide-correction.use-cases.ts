import type { CorrectionApprovedDto, CorrectionDto } from '@taskflow/contracts';

import { BusinessRuleViolationError, ResourceNotFoundError } from '../../../../core/errors';
import { isApproveReplay } from '../../domain/correction-request';
import { appendAdjustment } from '../adjustment-writer';
import { toEventDtos } from '../attendance-event-dto';
import { monthTotalsOf } from '../attendance-totals';
import {
  askOf,
  assertCorrectionRules,
  assertPending,
  correctionDto,
  transitionCorrection,
  type CorrectionDeps,
} from '../correction-steps';
import type { CorrectionRecord } from '../ports/correction-store.port';

type Decision = { id: string; expectedVersion: number; note?: string | undefined };

/**
 * Đơn bổ sung giờ — phía HR (hr-extended ADR-129, T-056): duyệt / từ chối, `hr:manage` KHÁC người gửi (luật self tuyệt
 * đối qua `authorizeWrite` ⇒ 403). Duyệt: `punch:<người gửi>` (bậc 4) → quyền (bậc 5, ADR-136) → kiểm LẠI luật gửi →
 * `appendAdjustment` (đúng đường HR thêm tay) → UPDATE có điều kiện. Thông báo `CORRECTION_APPROVED` thay
 * `ATTENDANCE_ADJUSTED`; `note` của lượt không chép lý do của nhân viên.
 */
export class DecideCorrectionUseCases {
  constructor(private readonly d: CorrectionDeps) {}

  /** `POST …/:id/approve` ⇒ `{ request, event, day, totals }`. */
  async approve(actorId: string, q: Decision): Promise<CorrectionApprovedDto> {
    const { d } = this;
    // Chủ đơn không đổi ⇒ đọc trước khóa để biết khóa ai.
    const owner = (await d.corrections.findById(q.id))?.userId;
    if (!owner) throw new ResourceNotFoundError('correction_request');
    const record = await d.uow.run(async () => {
      await d.events.lockUserPunch(owner);
      await d.company.authorizeWrite({ actorId, targetUserId: owner });
      const found = (await d.corrections.findById(q.id))!;
      if (isApproveReplay(found, { deciderId: actorId, expectedVersion: q.expectedVersion })) {
        return found;
      }
      assertPending(found, q.expectedVersion);
      if (!(await d.company.isEmployee(owner))) {
        throw new BusinessRuleViolationError(
          'REQUESTER_NOT_EMPLOYEE',
          'Người gửi không còn là nhân viên — chỉ có thể từ chối đơn này.',
        );
      }
      await assertCorrectionRules(d, owner, askOf(found));
      const eventId = d.ids.next();
      await appendAdjustment(d, {
        id: eventId,
        actorId,
        userId: owner,
        ...askOf(found),
        note: `Đơn bổ sung giờ ${found.id}`,
      });
      const done = await transitionCorrection(d, found, q.expectedVersion, {
        status: 'APPROVED',
        decidedById: actorId,
        decidedAt: d.clock.now(),
        decisionNote: q.note ?? null,
        createdEventId: eventId,
      });
      await this.#decided(actorId, done);
      return done;
    });
    const [event] = await toEventDtos(d.users, [
      (await d.events.findById(record.createdEventId!))!,
    ]);
    const { day, totals } = await monthTotalsOf(d, {
      userId: record.userId,
      date: record.workDate,
    });
    return { request: await correctionDto(d, record), event: event!, day, totals };
  }

  /** `POST …/:id/reject` — được cả khi người gửi đã nghỉ / hết cửa sổ (chỉ còn từ chối). */
  async reject(actorId: string, q: Decision): Promise<CorrectionDto> {
    const { d } = this;
    const record = await d.uow.run(async () => {
      const found = await d.corrections.findById(q.id);
      if (!found) throw new ResourceNotFoundError('correction_request');
      await d.company.authorizeWrite({ actorId, targetUserId: found.userId });
      const done = await transitionCorrection(d, found, q.expectedVersion, {
        status: 'REJECTED',
        decidedById: actorId,
        decidedAt: d.clock.now(),
        decisionNote: q.note ?? null,
        createdEventId: null,
      });
      await this.#decided(actorId, done);
      return done;
    });
    return correctionDto(d, record);
  }

  async #decided(actorId: string, done: CorrectionRecord): Promise<void> {
    await this.d.audit.record({
      actorId,
      action: 'CORRECTION_DECIDE',
      targetUserId: done.userId,
      refId: done.id,
      before: { status: 'PENDING' },
      after: { status: done.status, eventId: done.createdEventId },
    });
    await this.d.notifier.notify({
      type: done.status === 'APPROVED' ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
      requestId: done.id,
      actorId,
      recipient: { kind: 'user', userId: done.userId },
    });
  }
}
