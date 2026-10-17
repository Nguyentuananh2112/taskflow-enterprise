// T-037 / T-066: ràng buộc DB của chấm công / nghỉ phép / audit HR (migration 3, 4; Mốc 3.5 migration 5 bỏ
// `workspace_id` — chấm công thuộc công ty) — chốt chặn cuối khi app quên. Ràng buộc của bảng công ty
// (company_members, departures, token kích hoạt) ở company-constraints.int.ts; `workspace_members.grants` và
// `workspace_member_departures` đã bỏ ở migration 5 (grant ⇒ company_members, departure ⇒ company_member_departures).
// Các CHECK nghiệp vụ đơn nghỉ / số dư do test của T-038 / T-039 / T-063 / T-064 phủ theo use case.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, seedMinimal, truncateAll } from './db';

const prisma: PrismaClient = createTestPrisma();
let ctx: Awaited<ReturnType<typeof seedMinimal>>;

beforeEach(async () => {
  await truncateAll(prisma);
  ctx = await seedMinimal(prisma);
});
afterAll(() => prisma.$disconnect());

const event = (over: Record<string, unknown> = {}) =>
  prisma.attendanceEvent.create({
    data: {
      id: randomUUID(),
      userId: ctx.user.id,
      kind: 'IN',
      source: 'WEB',
      occurredAt: new Date('2026-10-16T01:00:00Z'),
      workDate: new Date('2026-10-16'),
      createdById: ctx.user.id,
      ...over,
    },
  });

describe('attendance_events (ADR-121, theo người — Mốc 3.5)', () => {
  it('một IN WEB còn hiệu lực / người / ngày; lượt đã hủy không giữ chỗ', async () => {
    const first = await event();
    await expect(event()).rejects.toThrow(/attendance_events_web_in_once_key|Unique constraint/);
    await prisma.attendanceEvent.update({
      where: { id: first.id },
      data: { voidedAt: new Date(), voidedById: ctx.user.id, voidReason: 'nhầm' },
    });
    await expect(event()).resolves.toBeDefined();
    await expect(event({ kind: 'OUT' })).resolves.toBeDefined();
  });

  it('idempotency_key duy nhất theo (user, source)', async () => {
    await event({ kind: 'OUT', idempotencyKey: 'k-1' });
    await expect(event({ kind: 'OUT', idempotencyKey: 'k-1' })).rejects.toThrow(
      /attendance_events_idempotency_key|Unique constraint/,
    );
    await expect(
      event({ kind: 'OUT', source: 'DEVICE', idempotencyKey: 'k-1' }),
    ).resolves.toBeDefined();
  });

  it('hủy thiếu người / lý do ⇒ CHECK; ADJUSTMENT thiếu note ⇒ CHECK', async () => {
    await expect(event({ voidedAt: new Date() })).rejects.toThrow(/attendance_events_void_chk/);
    await expect(event({ voidedAt: new Date(), voidedById: ctx.user.id })).rejects.toThrow(
      /attendance_events_void_chk/,
    );
    await expect(event({ source: 'ADJUSTMENT' })).rejects.toThrow(
      /attendance_events_adjustment_note_chk/,
    );
  });
});

describe('work_schedules (ADR-120, một lịch công ty)', () => {
  const schedule = (over: Record<string, unknown> = {}) =>
    prisma.workSchedule.create({
      data: {
        id: randomUUID(),
        effectiveFrom: new Date('2026-10-01'),
        workdays: 31,
        startMin: 480,
        endMin: 1020,
        breakStartMin: 720,
        breakEndMin: 780,
        createdById: ctx.user.id,
        ...over,
      },
    });

  it('ca hợp lệ; workdays / thứ tự giờ / grace sai ⇒ CHECK', async () => {
    await expect(schedule()).resolves.toBeDefined();
    await expect(schedule({ effectiveFrom: new Date('2026-10-02'), workdays: 0 })).rejects.toThrow(
      /work_schedules_workdays_chk/,
    );
    await expect(
      schedule({ effectiveFrom: new Date('2026-10-03'), breakStartMin: 1100 }),
    ).rejects.toThrow(/work_schedules_times_chk/);
    await expect(
      schedule({ effectiveFrom: new Date('2026-10-04'), graceMin: 241 }),
    ).rejects.toThrow(/work_schedules_grace_chk/);
  });

  it('một phiên bản / ngày hiệu lực cho cả công ty', async () => {
    await schedule();
    await expect(schedule()).rejects.toThrow(/work_schedules_effective_from_key|Unique constraint/);
  });
});

describe('holidays (một bảng công ty)', () => {
  it('khóa là ngày: cùng ngày hai lần ⇒ trùng khóa', async () => {
    await prisma.holiday.create({ data: { date: new Date('2026-12-25'), name: 'Lễ' } });
    await expect(
      prisma.holiday.create({ data: { date: new Date('2026-12-25'), name: 'Lễ 2' } }),
    ).rejects.toThrow(/holidays_pkey|Unique constraint/);
  });
});

describe('hr_audit_logs (B-L1, quyết định d)', () => {
  it('target_user_id / ref_id không FK: giữ được dấu vết khi đối tượng không còn', async () => {
    await expect(
      prisma.hrAuditLog.create({
        data: {
          id: randomUUID(),
          actorId: ctx.user.id,
          action: 'LEAVE_DECIDE',
          targetUserId: randomUUID(),
          refId: randomUUID(),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('actor_id NULL hợp lệ (admin:bootstrap — CLI, không có người)', async () => {
    await expect(
      prisma.hrAuditLog.create({
        data: { id: randomUUID(), actorId: null, action: 'COMPANY_ROLE_SET' },
      }),
    ).resolves.toMatchObject({ actorId: null });
  });

  it('actor_id FK Restrict: không xóa được user còn audit HR', async () => {
    await prisma.hrAuditLog.create({
      data: { id: randomUUID(), actorId: ctx.user.id, action: 'GRANT_SET' },
    });
    await expect(prisma.user.delete({ where: { id: ctx.user.id } })).rejects.toThrow();
  });
});

describe('leave_requests (migration 4, theo người — Mốc 3.5)', () => {
  const leave = (reason: string | null) =>
    prisma.$executeRaw`
      INSERT INTO leave_requests (id, user_id, type, start_date, end_date, reason, updated_at)
      VALUES (${randomUUID()}::uuid, ${ctx.user.id}::uuid, 'ANNUAL',
              DATE '2026-10-20', DATE '2026-10-20', ${reason}, now())`;

  it('reason: NULL hợp lệ; rỗng / chỉ khoảng trắng ⇒ CHECK', async () => {
    await expect(leave(null)).resolves.toBe(1);
    await expect(leave('ốm')).resolves.toBe(1);
    for (const blank of ['', '   ']) {
      await expect(leave(blank)).rejects.toThrow(/leave_requests_reason_not_blank_chk/);
    }
  });

  it('user FK Restrict: không xóa được user còn đơn nghỉ', async () => {
    await leave(null);
    await expect(prisma.user.delete({ where: { id: ctx.user.id } })).rejects.toThrow();
  });
});

describe('leave_balances (khóa theo người + năm — Mốc 3.5)', () => {
  it('một dòng / người / năm', async () => {
    await prisma.leaveBalance.create({ data: { userId: ctx.user.id, year: 2026 } });
    await expect(
      prisma.leaveBalance.create({ data: { userId: ctx.user.id, year: 2026 } }),
    ).rejects.toThrow(/leave_balances_pkey|Unique constraint/);
    await expect(
      prisma.leaveBalance.create({ data: { userId: ctx.user.id, year: 2027 } }),
    ).resolves.toBeDefined();
  });
});
