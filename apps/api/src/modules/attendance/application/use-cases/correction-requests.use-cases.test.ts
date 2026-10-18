import { CorrectionApprovedDto, CorrectionDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { HANA, key, MAX, MIA, OLIVIA, vnTime } from '../../testing/attendance-harness';
import { createCorrectionHarness } from '../../testing/correction-harness';

// T-056 (hr-extended ADR-129) tầng A: CR-08..CR-13 + quyền / khóa / thông báo / audit của đơn bổ sung giờ.
type H = Awaited<ReturnType<typeof createCorrectionHarness>>;
const out1745 = {
  date: '2026-11-16',
  kind: 'OUT' as 'IN' | 'OUT',
  time: '17:45',
  nextDay: false,
  reason: 'Quên bấm Ra',
};

/** Mia: IN 08:00 ngày 16/11 (web), không OUT ⇒ MISSING_OUT; đồng hồ quay về 17/11 10:00. */
async function missingOut(t: H, userId = MIA) {
  t.at('2026-11-16 08:00');
  await t.punch('IN', key(900 + userId.length), userId);
  t.at('2026-11-17 10:00');
}
const submit = (t: H, n: number, body = out1745, userId = MIA) =>
  t.useCases.submit(userId, body, key(n));
const locksOf = (t: H) => {
  const events = t.backend.events as object;
  return 'locks' in events ? (events.locks as string[]) : null;
};

describe('gửi đơn (attendance:self)', () => {
  it('MISSING_OUT xin giờ ra ⇒ PENDING, đủ DTO (ô ngày hiện tại), audit không lý do, thông báo cho HR', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const { created, dto } = await submit(t, 1);
    expect(created).toBe(true);
    expect(CorrectionDto.parse(dto)).toEqual(dto);
    expect(dto).toMatchObject({
      userId: MIA,
      user: { id: MIA, fullName: 'Mia' },
      date: '2026-11-16',
      kind: 'OUT',
      time: '17:45',
      status: 'PENDING',
      reason: 'Quên bấm Ra',
      version: 1,
      decidedBy: null,
      createdEventId: null,
      day: { date: '2026-11-16', status: 'MISSING_OUT' },
    });
    expect(t.audit.at(-1)).toMatchObject({
      action: 'CORRECTION_SUBMIT',
      targetUserId: MIA,
      refId: dto.id,
    });
    expect(JSON.stringify(t.audit)).not.toContain('Quên bấm Ra');
    expect(t.sent).toEqual([
      { type: 'CORRECTION_SUBMITTED', requestId: dto.id, actorId: MIA, recipient: { kind: 'hr' } },
    ]);
  });

  it('CR-13 lặp cùng Idempotency-Key ⇒ đơn cũ (created false), không thêm; cùng key khác nội dung ⇒ 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const first = await submit(t, 1);
    const again = await submit(t, 1);
    expect(again).toEqual({ created: false, dto: first.dto });
    await expect(submit(t, 1, { ...out1745, time: '17:50' })).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(t.sent).toHaveLength(1);
  });

  it('CR-06 đã có đơn chờ cùng ngày + loại (key khác) ⇒ 409 correction_pending_exists; hủy rồi gửi lại được', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const first = await submit(t, 1);
    await expect(submit(t, 2, { ...out1745, time: '18:00' })).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'correction_pending_exists' },
    });
    await t.useCases.cancel(MIA, { id: first.dto.id, expectedVersion: 1 });
    expect((await submit(t, 3, { ...out1745, time: '18:00' })).created).toBe(true);
  });

  it('luật gửi ⇒ 422 đúng rule (đã có IN ⇒ CORRECTION_EVENT_EXISTS); không ghi gì', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    await expect(submit(t, 1, { ...out1745, kind: 'IN', time: '07:30' })).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'CORRECTION_EVENT_EXISTS' },
    });
    expect(t.audit.filter((a) => a.action === 'CORRECTION_SUBMIT')).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('Admin (không phải nhân viên) / người hết quyền ⇒ 401 SAU khóa punch của chính mình', async () => {
    const t = await createCorrectionHarness();
    await expect(submit(t, 1, out1745, OLIVIA)).rejects.toMatchObject({ statusCode: 401 });
    const locks = locksOf(t);
    if (locks) expect(locks.at(-1)).toBe(`taskflow:attendance:punch:${OLIVIA}`);
    t.revoked.add(MAX);
    await expect(submit(t, 2, out1745, MAX)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('hủy đơn (người gửi)', () => {
  it('đơn của mình ⇒ CANCELLED (không người quyết định), thông báo HR; lần 2 ⇒ 409 invalid_transition', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const { dto } = await submit(t, 1);
    const cancelled = await t.useCases.cancel(MIA, { id: dto.id, expectedVersion: 1 });
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      version: 2,
      decidedBy: null,
      decidedAt: null,
    });
    expect(t.sent.at(-1)).toEqual({
      type: 'CORRECTION_CANCELLED',
      requestId: dto.id,
      actorId: MIA,
      recipient: { kind: 'hr' },
    });
    await expect(t.useCases.cancel(MIA, { id: dto.id, expectedVersion: 2 })).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'invalid_transition' },
    });
  });

  it('SEC-HR-48 đơn người khác / id lạ ⇒ 404 cùng hình dạng; lệch version ⇒ 409 VERSION_CONFLICT', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const { dto } = await submit(t, 1);
    for (const id of [dto.id, '0199e5a2-0000-7000-8000-00000000ffff']) {
      await expect(t.useCases.cancel(MAX, { id, expectedVersion: 1 })).rejects.toMatchObject({
        statusCode: 404,
        details: { resource: 'correction_request' },
      });
    }
    await expect(t.useCases.cancel(MIA, { id: dto.id, expectedVersion: 7 })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERSION_CONFLICT',
    });
  });
});

describe('duyệt / từ chối (hr:manage, khác người gửi)', () => {
  it('CR-08 duyệt ⇒ đúng 1 ADJUSTMENT như HR thêm tay (giờ theo lịch, note không chép lý do), ô ngày PRESENT; khóa punch của người gửi TRƯỚC quyền', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const { dto } = await submit(t, 1);
    const locks = locksOf(t);
    if (locks) locks.length = 0;
    const r = await t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1, note: 'OK' });
    expect(CorrectionApprovedDto.parse(r)).toEqual(r);
    expect(r.request).toMatchObject({
      status: 'APPROVED',
      version: 2,
      decidedBy: { id: HANA, fullName: 'Hana' },
      decisionNote: 'OK',
      createdEventId: r.event.id,
    });
    expect(r.event).toMatchObject({
      userId: MIA,
      kind: 'OUT',
      source: 'ADJUSTMENT',
      workDate: '2026-11-16',
      occurredAt: vnTime('2026-11-16 17:45').toISOString(),
      note: `Đơn bổ sung giờ ${dto.id}`,
      createdBy: { id: HANA, fullName: 'Hana' },
    });
    expect(r.day).toMatchObject({ date: '2026-11-16', status: 'PRESENT' });
    expect((await t.backend.eventRows()).filter((e) => e.source === 'ADJUSTMENT')).toHaveLength(1);
    if (locks) expect(locks).toEqual([`taskflow:attendance:punch:${MIA}`]);
    expect(t.audit.map((a) => a.action).slice(-2)).toEqual(['EVENT_ADJUST', 'CORRECTION_DECIDE']);
    expect(JSON.stringify(t.audit)).not.toContain('Quên bấm Ra');
    expect(t.sent.at(-1)).toEqual({
      type: 'CORRECTION_APPROVED',
      requestId: dto.id,
      actorId: HANA,
      recipient: { kind: 'user', userId: MIA },
    });
    expect(t.notified).toEqual([]); // không ATTENDANCE_ADJUSTED — thay bằng CORRECTION_APPROVED
  });

  it('CR-10 lặp approve cùng người + cùng expectedVersion ⇒ kết quả cũ, không thêm lượt; HR khác ⇒ 409 invalid_transition', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const { dto } = await submit(t, 1);
    const first = await t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1 });
    const again = await t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1 });
    expect(again.event.id).toBe(first.event.id);
    expect((await t.backend.eventRows()).filter((e) => e.source === 'ADJUSTMENT')).toHaveLength(1);
    await expect(
      t.useCases.approve(OLIVIA, { id: dto.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'invalid_transition' },
    });
  });

  it('SEC-HR-49 HR tự duyệt / từ chối đơn của mình ⇒ 403, không lượt; nhân viên thường duyệt ⇒ 403', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t, HANA);
    const { dto } = await submit(t, 1, out1745, HANA);
    await expect(
      t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(t.useCases.reject(HANA, { id: dto.id, expectedVersion: 1 })).rejects.toMatchObject(
      {
        statusCode: 403,
      },
    );
    await expect(t.useCases.approve(MAX, { id: dto.id, expectedVersion: 1 })).rejects.toMatchObject(
      {
        statusCode: 403,
      },
    );
    expect((await t.backend.eventRows()).filter((e) => e.source === 'ADJUSTMENT')).toEqual([]);
  });

  it('CR-11 người gửi không còn là nhân viên (nâng Admin) ⇒ approve 422 REQUESTER_NOT_EMPLOYEE; reject vẫn được', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    const { dto } = await submit(t, 1);
    t.members.set(MIA, 'ADMIN');
    await expect(
      t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'REQUESTER_NOT_EMPLOYEE' },
    });
    const rejected = await t.useCases.reject(HANA, {
      id: dto.id,
      expectedVersion: 1,
      note: 'Đã nghỉ',
    });
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Đã nghỉ',
      createdEventId: null,
    });
    expect(t.sent.at(-1)).toMatchObject({
      type: 'CORRECTION_REJECTED',
      recipient: { kind: 'user', userId: MIA },
    });
  });

  it('CR-09 kiểm LẠI luật lúc duyệt: nhân viên đã bấm Ra sau khi gửi ⇒ 422 CORRECTION_EVENT_EXISTS, không lượt mới', async () => {
    const t = await createCorrectionHarness();
    t.at('2026-11-17 08:00');
    await t.punch('IN', key(1));
    t.at('2026-11-17 10:00');
    const { dto } = await submit(t, 2, { ...out1745, date: '2026-11-17', time: '09:30' });
    await t.punch('OUT', key(3));
    await expect(
      t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'CORRECTION_EVENT_EXISTS' },
    });
    expect((await t.backend.eventRows()).filter((e) => e.source === 'ADJUSTMENT')).toEqual([]);
  });

  it('CLK-HR-10 (tầng A) hết cửa sổ lúc duyệt ⇒ 422 CORRECTION_DATE_OUT_OF_RANGE; từ chối vẫn được', async () => {
    const t = await createCorrectionHarness('2026-11-30 10:00');
    const { dto } = await submit(t, 1, {
      ...out1745,
      kind: 'IN',
      date: '2026-10-05',
      time: '08:00',
    });
    t.at('2026-12-01 09:00');
    await expect(
      t.useCases.approve(HANA, { id: dto.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'CORRECTION_DATE_OUT_OF_RANGE' },
    });
    expect((await t.useCases.reject(HANA, { id: dto.id, expectedVersion: 1 })).status).toBe(
      'REJECTED',
    );
  });

  it('id lạ ⇒ 404; đơn đã hủy ⇒ approve / reject 409 invalid_transition; lệch version ⇒ VERSION_CONFLICT', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    await expect(
      t.useCases.approve(HANA, { id: '0199e5a2-0000-7000-8000-00000000ffff', expectedVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 404, details: { resource: 'correction_request' } });
    const { dto } = await submit(t, 1);
    await expect(
      t.useCases.approve(HANA, { id: dto.id, expectedVersion: 5 }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    await t.useCases.cancel(MIA, { id: dto.id, expectedVersion: 1 });
    for (const act of ['approve', 'reject'] as const) {
      await expect(t.useCases[act](HANA, { id: dto.id, expectedVersion: 2 })).rejects.toMatchObject(
        {
          statusCode: 409,
          details: { reason: 'invalid_transition' },
        },
      );
    }
  });
});

describe('danh sách', () => {
  it('mine ⇒ chỉ đơn của mình; HR ⇒ cả công ty, mới nhất trước, lọc status, phân trang cursor', async () => {
    const t = await createCorrectionHarness();
    await missingOut(t);
    await missingOut(t, MAX);
    const a = await submit(t, 1);
    t.clock.advance(1_000);
    const b = await submit(t, 2, out1745, MAX);
    const mine = await t.useCases.list({ mineOf: MIA, limit: 50 });
    expect(mine.data.map((r) => r.id)).toEqual([a.dto.id]);
    const page1 = await t.useCases.list({ limit: 1 });
    expect(page1.data.map((r) => r.id)).toEqual([b.dto.id]);
    const page2 = await t.useCases.list({ limit: 1, cursor: page1.nextCursor! });
    expect(page2).toEqual({ data: [expect.objectContaining({ id: a.dto.id })], nextCursor: null });
    await t.useCases.cancel(MAX, { id: b.dto.id, expectedVersion: 1 });
    expect((await t.useCases.list({ status: 'PENDING', limit: 50 })).data.map((r) => r.id)).toEqual(
      [a.dto.id],
    );
  });
});
