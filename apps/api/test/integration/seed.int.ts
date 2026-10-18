// CO-07 (company-level ADR-138): seed dev dựng đủ vai trò trên schema thật — chạy lại được (xóa sạch trước), ràng
// buộc migration 5 (CHECK / partial unique) đều qua, link kích hoạt khớp hash đã lưu, Admin không có quyền ngầm.
import { createHash } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { seedDatabase, type SeedResult } from '../../prisma/seed-data';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateAll } from './db';
import { createPrismaTestApp, PRISMA_APP_PASSWORD_HASH } from './support/prisma-http-app';

const prisma: PrismaClient = createTestPrisma();
const NOW = new Date('2026-11-18T03:00:00.000Z'); // thứ Tư 18/11/2026 10:00 giờ VN
let seeded: SeedResult;

beforeEach(async () => {
  await truncateAll(prisma);
  seeded = await seedDatabase(prisma, {
    passwordHash: PRISMA_APP_PASSWORD_HASH,
    webOrigin: 'http://localhost:3001',
    now: NOW,
  });
});
afterAll(() => prisma.$disconnect());

describe('seed dev Mốc 3.5 (CO-07)', () => {
  it('một công ty; Admin không phải nhân viên; HR / Kế toán là grant của nhân viên; Quinn đã nghỉ, không còn dòng', async () => {
    expect(await prisma.company.findMany()).toMatchObject([{ id: 1, name: 'Công ty Mẫu' }]);
    const members = await prisma.companyMember.findMany({ include: { user: true } });
    const byName = new Map(members.map((m) => [m.user.email.split('@')[0], m]));
    expect(byName.get('olivia')).toMatchObject({ role: 'ADMIN', grants: [], startDate: null });
    expect(byName.get('pam')).toMatchObject({ role: 'EMPLOYEE', grants: ['HR_MANAGE'] });
    expect(byName.get('max')).toMatchObject({ role: 'EMPLOYEE', grants: ['PAYROLL_MANAGE'] });
    for (const n of ['mia', 'vic', 'otto']) {
      expect(byName.get(n)).toMatchObject({ role: 'EMPLOYEE', grants: [] });
    }
    expect(byName.get('pam')?.startDate?.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(byName.has('quinn')).toBe(false);
    expect(await prisma.companyMemberDeparture.findMany()).toMatchObject([
      { userId: seeded.users.Quinn, reason: 'OFFBOARDED', role: 'EMPLOYEE' },
    ]);
    const quinnDays = await prisma.attendanceEvent.findMany({
      where: { userId: seeded.users.Quinn },
    });
    expect(quinnDays.length).toBe(6);
    expect(quinnDays.every((e) => e.workDate.toISOString() <= '2026-10-31T00:00:00.000Z')).toBe(
      true,
    );
  });

  it('Nina chờ kích hoạt: không mật khẩu, nhiệm kỳ từ hôm nay; link chứa token khớp hash, hạn 7 ngày, do HR cấp', async () => {
    const nina = await prisma.user.findUniqueOrThrow({ where: { id: seeded.users.Nina } });
    expect(nina.passwordHash).toBeNull();
    const token = /#t=([A-Za-z0-9_-]{43})$/.exec(seeded.activationLink)?.[1] ?? '';
    const row = await prisma.accountActivationToken.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    expect(row).toMatchObject({ userId: nina.id, createdById: seeded.users.Pam, usedAt: null });
    expect(row.expiresAt.getTime() - NOW.getTime()).toBe(7 * 24 * 3600 * 1000);
    const member = await prisma.companyMember.findUniqueOrThrow({ where: { userId: nina.id } });
    expect(member.startDate?.toISOString().slice(0, 10)).toBe('2026-11-18');
  });

  it('chấm công 5 ngày làm việc gần nhất (không có hôm nay, không Admin); 3 đơn nghỉ; 2 ngày lễ; thông báo HR', async () => {
    const events = await prisma.attendanceEvent.findMany({
      where: { userId: { not: seeded.users.Quinn } },
    });
    expect(events.length).toBe(5 * 5 * 2);
    expect(events.some((e) => e.userId === seeded.users.Olivia)).toBe(false);
    expect(new Set(events.map((e) => e.workDate.toISOString().slice(0, 10)))).toEqual(
      new Set(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16', '2026-11-17']),
    );
    const leaves = await prisma.leaveRequest.findMany({ orderBy: { startDate: 'asc' } });
    expect(leaves.map((l) => l.status)).toEqual(['PENDING', 'APPROVED', 'REJECTED']);
    expect(await prisma.holiday.count()).toBe(2);
    const notes = await prisma.notification.findMany({ where: { type: 'LEAVE_SUBMITTED' } });
    expect(notes.map((n) => n.recipientId).sort()).toEqual(
      [seeded.users.Pam, seeded.users.Olivia].sort(),
    );
  });

  it('Olivia (Admin) chỉ ở MỘT workspace — không quyền ngầm vào ws còn lại; chạy seed lần 2 vẫn được', async () => {
    const ws = await prisma.workspace.findMany({ include: { members: true } });
    expect(ws).toHaveLength(2);
    const withOlivia = ws.filter((w) => w.members.some((m) => m.userId === seeded.users.Olivia));
    expect(withOlivia.map((w) => w.slug)).toEqual(['nhom-san-pham']);
    const again = await seedDatabase(prisma, {
      passwordHash: 'x',
      webOrigin: 'http://localhost:3001',
      now: NOW,
    });
    expect(await prisma.user.count()).toBe(8);
    expect(again.users.Olivia).not.toBe(seeded.users.Olivia);
    expect(await prisma.payrollSettings.count()).toBe(1);
  });

  // Bug 18/10 (localhost): TRUNCATE … CASCADE (payroll_settings.updated_by_id → users) xóa dòng singleton của
  // migration, seed không tạo lại ⇒ POST /payroll/runs/:period 500 P2025.
  it('cài đặt lương: đúng 1 dòng mặc định của migration; Kế toán tạo nháp kỳ đã kết thúc ⇒ 201, không 500', async () => {
    expect(await prisma.payrollSettings.findMany()).toMatchObject([
      { id: 1, seniorityPerYear: 500_000n, version: 1, updatedById: null },
    ]);
    const t = createPrismaTestApp(prisma, NOW);
    const res = await request(t.app)
      .post('/api/v1/payroll/runs/2026-10')
      .set(await t.login('max@example.test'))
      .send({});
    expect(res.status, res.text).toBe(201);
    expect(t.logs.some((l) => l.includes('payroll.settings_restored_default'))).toBe(false);
  });

  it('dòng cài đặt lương bị xóa ngoài ý muốn ⇒ getSettings tạo lại mặc định + log warn, tạo nháp vẫn 201', async () => {
    await prisma.payrollSettings.deleteMany();
    const t = createPrismaTestApp(prisma, NOW);
    const res = await request(t.app)
      .post('/api/v1/payroll/runs/2026-09')
      .set(await t.login('max@example.test'))
      .send({});
    expect(res.status, res.text).toBe(201);
    expect(await prisma.payrollSettings.findMany()).toMatchObject([
      { id: 1, seniorityPerYear: 500_000n, version: 1 },
    ]);
    const warn = t.logs.find((l) => l.includes('payroll.settings_restored_default'));
    expect(warn && JSON.parse(warn)).toMatchObject({ level: 'warn' });
  });
});
