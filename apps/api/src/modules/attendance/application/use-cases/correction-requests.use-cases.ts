import type { CorrectionDto, SubmitCorrectionBody } from '@taskflow/contracts';

import {
  BusinessRuleViolationError,
  ResourceConflictError,
  ResourceNotFoundError,
} from '../../../../core/errors';
import type { CorrectionAsk } from '../../domain/correction-rules';
import {
  assertCorrectionRules,
  correctionDto,
  minuteOf,
  transitionCorrection,
  type CorrectionDeps,
} from '../correction-steps';
import { toCorrectionDtos } from '../correction-view';
import type { CorrectionRecord } from '../ports/correction-store.port';

/**
 * Đơn bổ sung giờ — phía NHÂN VIÊN (hr-extended ADR-129, T-056): gửi / hủy đơn của mình + danh sách. Gửi lấy
 * `taskflow:attendance:punch:<user>` (bậc 4) rồi `assertActiveEmployee` (bậc 5, ADR-136). Lý do không vào audit / thông báo.
 */
export class CorrectionRequestsUseCases {
  constructor(private readonly d: CorrectionDeps) {}

  /** `POST attendance/corrections` ⇒ `{ created, dto }` (lặp cùng `Idempotency-Key` ⇒ `created: false`, đơn cũ). */
  async submit(
    actorId: string,
    body: SubmitCorrectionBody,
    idempotencyKey: string,
  ): Promise<{ created: boolean; dto: CorrectionDto }> {
    const { d } = this;
    const ask: CorrectionAsk = {
      date: body.date,
      kind: body.kind,
      minuteOfDay: minuteOf(body.time),
      nextDay: body.nextDay,
    };
    const result = await d.uow.run(async () => {
      await d.events.lockUserPunch(actorId);
      await d.company.assertActiveEmployee(actorId);
      const replay = await this.#replay(actorId, idempotencyKey, ask);
      if (replay) return { created: false, record: replay };
      await assertCorrectionRules(d, actorId, ask);
      const now = d.clock.now();
      const record: CorrectionRecord = {
        id: d.ids.next(),
        userId: actorId,
        workDate: ask.date,
        kind: ask.kind,
        minuteOfDay: ask.minuteOfDay,
        nextDay: ask.nextDay,
        reason: body.reason,
        status: 'PENDING',
        idempotencyKey,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        createdEventId: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const inserted = await d.corrections.insert(record);
      if (inserted === 'pending_exists') {
        throw new ResourceConflictError(
          { reason: 'correction_pending_exists' },
          'Bạn đã có đơn bổ sung giờ đang chờ duyệt cho ngày này.',
        );
      }
      if (inserted === 'key_exists') {
        // Hai request cùng key song song (khóa punch tuần tự hóa — phòng thủ): trả đơn của request thắng.
        return { created: false, record: (await this.#replay(actorId, idempotencyKey, ask))! };
      }
      await d.audit.record({
        actorId,
        action: 'CORRECTION_SUBMIT',
        targetUserId: actorId,
        refId: record.id,
        after: {
          workDate: ask.date,
          kind: ask.kind,
          minuteOfDay: ask.minuteOfDay,
          nextDay: ask.nextDay,
        },
      });
      await d.notifier.notify({
        type: 'CORRECTION_SUBMITTED',
        requestId: record.id,
        actorId,
        recipient: { kind: 'hr' },
      });
      return { created: true, record };
    });
    return { created: result.created, dto: await correctionDto(d, result.record) };
  }

  /** `POST …/:id/cancel` — chỉ đơn của mình (người khác ⇒ 404, không lộ tồn tại). */
  async cancel(
    actorId: string,
    q: { id: string; expectedVersion: number },
  ): Promise<CorrectionDto> {
    const { d } = this;
    const record = await d.uow.run(async () => {
      const found = await d.corrections.findById(q.id);
      if (!found || found.userId !== actorId) throw new ResourceNotFoundError('correction_request');
      const done = await transitionCorrection(d, found, q.expectedVersion, {
        status: 'CANCELLED',
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
        createdEventId: null,
      });
      await d.audit.record({
        actorId,
        action: 'CORRECTION_CANCEL',
        targetUserId: actorId,
        refId: q.id,
        before: { status: 'PENDING' },
        after: { status: 'CANCELLED' },
      });
      await d.notifier.notify({
        type: 'CORRECTION_CANCELLED',
        requestId: q.id,
        actorId,
        recipient: { kind: 'hr' },
      });
      return done;
    });
    return correctionDto(d, record);
  }

  /** `GET attendance/corrections` — `mineOf` ⇒ chỉ của người đó; không ⇒ cả công ty (route đã chốt `hr:manage`). */
  async list(q: {
    mineOf?: string;
    status?: CorrectionRecord['status'];
    cursor?: string;
    limit: number;
  }): Promise<{ data: CorrectionDto[]; nextCursor: string | null }> {
    const page = await this.d.corrections.list({
      ...(q.mineOf ? { userId: q.mineOf } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: q.limit,
    });
    return { data: await toCorrectionDtos(this.d, page.rows, true), nextCursor: page.nextCursor };
  }

  async #replay(userId: string, key: string, ask: CorrectionAsk): Promise<CorrectionRecord | null> {
    const prior = await this.d.corrections.findByKey(userId, key);
    if (!prior) return null;
    const same =
      prior.workDate === ask.date &&
      prior.kind === ask.kind &&
      prior.minuteOfDay === ask.minuteOfDay &&
      prior.nextDay === ask.nextDay;
    if (!same) {
      throw new BusinessRuleViolationError(
        'IDEMPOTENCY_KEY_REUSED',
        'Mã gửi đã dùng cho một đơn khác — mở lại form để gửi đơn mới.',
      );
    }
    return prior;
  }
}
