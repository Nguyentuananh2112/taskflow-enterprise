// T-055 tầng I (hr-extended §R27 D9): đơn bổ sung giờ trong job retention trên Postgres thật — xóa đơn theo ngày công
// TRƯỚC lượt chấm (FK created_event_id NO ACTION), scrub lý do / ghi chú theo mốc D3 trừ PENDING, lượt chấm còn
// được đơn tham chiếu không bị xóa (không vỡ lô), CHECK của migration 8.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RetentionJob, type RetentionPolicy } from '../../../src/composition/retention-job';
import { prismaRetentionStores } from '../../../src/composition/retention-stores';
import { FakeClock } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const B: RetentionPolicy = {
  clientInfoDays: 395,
  leaveReasonDays: 395, // mốc D3 = 2025-11-01
  recordsDays: 730, // mốc D2 / D9 = 2024-12-01
  notificationsDays: 180,
  hrAuditDays: 1826,
};
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

let mia: string;
let hr: string;

beforeEach(async () => {
  await resetDatabase();
  const user = async (name: string) =>
    (
      await testPrisma().user.create({
        data: { email: `${name}-${randomUUID()}@example.test`, fullName: name, passwordHash: 'x' },
      })
    ).id;
  mia = await user('mia');
  hr = await user('hr');
});
afterAll(disconnectTestPrisma);

const adjustment = (workDate: string) =>
  testPrisma().attendanceEvent.create({
    data: {
      userId: mia,
      kind: 'OUT',
      source: 'ADJUSTMENT',
      occurredAt: new Date(`${workDate}T10:00:00.000Z`),
      workDate: day(workDate),
      note: 'Đơn bổ sung giờ',
      createdById: hr,
    },
  });

const correction = (
  workDate: string,
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
  createdEventId: string | null = null,
) =>
  testPrisma().attendanceCorrectionRequest.create({
    data: {
      id: randomUUID(),
      userId: mia,
      workDate: day(workDate),
      kind: 'OUT',
      minuteOfDay: 17 * 60,
      reason: 'Quên bấm Ra khi về',
      status,
      idempotencyKey: randomUUID(),
      createdEventId,
      ...(status === 'APPROVED' || status === 'REJECTED'
        ? { decidedById: hr, decidedAt: day(workDate), decisionNote: 'ok' }
        : {}),
    },
  });

const job = () => {
  const uow = new RecordingUnitOfWork();
  return new RetentionJob({
    stores: prismaRetentionStores(() => uow.db()),
    policy: B,
    uow,
    clock: new FakeClock(NOW),
  });
};

describe('D9 retention đơn bổ sung giờ', () => {
  it('đơn APPROVED cũ + lượt ADJUSTMENT của nó xóa cùng một lượt (D9 trước D2); đơn ngày = mốc giữ', async () => {
    const oldEvent = await adjustment('2024-11-30');
    await correction('2024-11-30', 'APPROVED', oldEvent.id);
    await correction('2024-11-30', 'PENDING');
    const keptEvent = await adjustment('2024-12-01');
    const kept = await correction('2024-12-01', 'APPROVED', keptEvent.id);

    const res = await job().execute();
    expect(res.rows).toMatchObject({ attendance_corrections: 2, attendance_events: 1 });
    const left = await testPrisma().attendanceCorrectionRequest.findMany({ select: { id: true } });
    expect(left.map((r) => r.id)).toEqual([kept.id]);
    const events = await testPrisma().attendanceEvent.findMany({ select: { id: true } });
    expect(events.map((e) => e.id)).toEqual([keptEvent.id]);
  });

  it('lượt chấm cũ còn được đơn (chưa tới hạn) tham chiếu ⇒ giữ, lô không vỡ', async () => {
    const oldEvent = await adjustment('2024-11-30');
    await correction('2024-12-01', 'APPROVED', oldEvent.id);
    const res = await job().execute();
    expect(res.complete).toBe(true);
    expect(res.rows).toMatchObject({ attendance_events: 0 });
    expect(await testPrisma().attendanceEvent.count()).toBe(1);
  });

  it("D9': reason + decision_note ⇒ NULL trước mốc D3, trừ PENDING; sau mốc giữ nguyên", async () => {
    const e = await adjustment('2025-10-31');
    const approved = await correction('2025-10-31', 'APPROVED', e.id);
    const pending = await correction('2025-10-31', 'PENDING');
    const recent = await correction('2025-11-01', 'REJECTED');
    await job().execute();
    const byId = async (id: string) =>
      testPrisma().attendanceCorrectionRequest.findUniqueOrThrow({
        where: { id },
        select: { reason: true, decisionNote: true },
      });
    expect(await byId(approved.id)).toEqual({ reason: null, decisionNote: null });
    expect(await byId(pending.id)).toMatchObject({ reason: 'Quên bấm Ra khi về' });
    expect(await byId(recent.id)).toEqual({ reason: 'Quên bấm Ra khi về', decisionNote: 'ok' });
  });
});

describe('migration 8 — CHECK + unique', () => {
  it('DB từ chối dữ liệu sai trạng thái / giờ; một PENDING / (user, ngày, loại)', async () => {
    const base = {
      userId: mia,
      workDate: day('2026-11-02'),
      kind: 'OUT' as const,
      minuteOfDay: 1000,
      reason: 'x',
    };
    const create = (extra: object) =>
      testPrisma().attendanceCorrectionRequest.create({
        data: { id: randomUUID(), idempotencyKey: randomUUID(), ...base, ...extra },
      });
    for (const bad of [
      { minuteOfDay: 1440 },
      { nextDay: true, minuteOfDay: 400 },
      { kind: 'IN', nextDay: true, minuteOfDay: 100 },
      { reason: null },
      { reason: '  ' },
      { status: 'APPROVED' }, // thiếu người duyệt + lượt
      { status: 'REJECTED' }, // thiếu người duyệt
      { status: 'CANCELLED', decidedById: hr, decidedAt: NOW },
      { decisionNote: 'ghi chú khi còn PENDING' },
      { idempotencyKey: ' ' },
      { version: 0 },
    ]) {
      await expect(create(bad)).rejects.toThrow();
    }
    await create({});
    await expect(create({})).rejects.toThrow(); // partial unique PENDING
    await expect(
      create({ status: 'REJECTED', decidedById: hr, decidedAt: NOW }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    const key = randomUUID();
    await create({
      kind: 'IN',
      minuteOfDay: 480,
      idempotencyKey: key,
      workDate: day('2026-11-03'),
    });
    await expect(
      create({ kind: 'IN', minuteOfDay: 480, idempotencyKey: key, workDate: day('2026-11-04') }),
    ).rejects.toThrow(); // (user, idempotency_key)
  });
});
