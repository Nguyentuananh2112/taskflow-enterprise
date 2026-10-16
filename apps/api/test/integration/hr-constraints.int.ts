// T-037: ràng buộc DB của migration 3 (attendance-leave.md §3) — chốt chặn cuối khi app quên.
// Các CHECK nghiệp vụ đơn nghỉ / số dư do test của T-038 / T-039 phủ theo use case.
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

const member = (role: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER', grants: 'HR_MANAGE'[]) =>
  prisma.workspaceMember.create({
    data: { workspaceId: ctx.w1.id, userId: ctx.user.id, role, grants },
  });

const event = (over: Record<string, unknown> = {}) =>
  prisma.attendanceEvent.create({
    data: {
      id: randomUUID(),
      workspaceId: ctx.w1.id,
      userId: ctx.user.id,
      kind: 'IN',
      source: 'WEB',
      occurredAt: new Date('2026-10-16T01:00:00Z'),
      workDate: new Date('2026-10-16'),
      createdById: ctx.user.id,
      ...over,
    },
  });

describe('workspace_members.grants (ADR-119, B-M2)', () => {
  it.each(['OWNER', 'VIEWER'] as const)('%s có grant ⇒ CHECK chặn', async (role) => {
    await expect(member(role, ['HR_MANAGE'])).rejects.toThrow(/workspace_members_grants_role_chk/);
  });

  it('MEMBER / PM có grant hợp lệ; mặc định grants = {}', async () => {
    await expect(member('MEMBER', ['HR_MANAGE'])).resolves.toMatchObject({ grants: ['HR_MANAGE'] });
    await prisma.workspaceMember.deleteMany();
    await expect(member('PM', ['HR_MANAGE'])).resolves.toBeDefined();
    await prisma.workspaceMember.deleteMany();
    const plain = await prisma.workspaceMember.create({
      data: { workspaceId: ctx.w1.id, userId: ctx.user.id, role: 'VIEWER' },
    });
    expect(plain.grants).toEqual([]);
  });

  it('nâng MEMBER có grant lên OWNER mà quên xóa grants ⇒ CHECK chặn UPDATE', async () => {
    await member('MEMBER', ['HR_MANAGE']);
    await expect(
      prisma.workspaceMember.updateMany({
        where: { userId: ctx.user.id },
        data: { role: 'OWNER' },
      }),
    ).rejects.toThrow(/workspace_members_grants_role_chk/);
  });
});

describe('attendance_events (ADR-121)', () => {
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

  it('idempotency_key duy nhất theo (ws, user, source)', async () => {
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

describe('work_schedules (ADR-120)', () => {
  const schedule = (over: Record<string, unknown> = {}) =>
    prisma.workSchedule.create({
      data: {
        id: randomUUID(),
        workspaceId: ctx.w1.id,
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
    await expect(schedule({ workdays: 0 })).rejects.toThrow(/work_schedules_workdays_chk/);
    await expect(schedule({ breakStartMin: 1100 })).rejects.toThrow(/work_schedules_times_chk/);
    await expect(schedule({ graceMin: 241 })).rejects.toThrow(/work_schedules_grace_chk/);
  });
});

describe('hr_audit_logs (B-L1, quyết định d)', () => {
  it('target_user_id / ref_id không FK: giữ được dấu vết khi đối tượng không còn', async () => {
    await expect(
      prisma.hrAuditLog.create({
        data: {
          id: randomUUID(),
          workspaceId: ctx.w1.id,
          actorId: ctx.user.id,
          action: 'LEAVE_DECIDE',
          targetUserId: randomUUID(),
          refId: randomUUID(),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('actor_id FK Restrict: không xóa được user còn audit HR', async () => {
    await prisma.hrAuditLog.create({
      data: { id: randomUUID(), workspaceId: ctx.w1.id, actorId: ctx.user.id, action: 'GRANT' },
    });
    await expect(prisma.user.delete({ where: { id: ctx.user.id } })).rejects.toThrow();
  });
});
