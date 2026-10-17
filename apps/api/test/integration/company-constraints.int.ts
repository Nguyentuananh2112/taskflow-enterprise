// Mốc 3.5 (T-061): ràng buộc DB của migration 5 company_level (company-level.md §3) — chốt chặn cuối khi app quên.
import { createHash, randomUUID } from 'node:crypto';

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

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const member = (data: Record<string, unknown>) =>
  prisma.companyMember.create({ data: { userId: ctx.user.id, role: 'EMPLOYEE', ...data } });

describe('companies (một dòng)', () => {
  it('id ≠ 1 ⇒ CHECK; tên rỗng ⇒ CHECK', async () => {
    await expect(prisma.company.create({ data: { id: 2, name: 'X' } })).rejects.toThrow(
      /companies_single_row_chk/,
    );
    await expect(prisma.company.create({ data: { id: 1, name: '   ' } })).rejects.toThrow(
      /companies_name_not_blank_chk/,
    );
    await expect(
      prisma.company.create({ data: { id: 1, name: 'Công ty' } }),
    ).resolves.toBeDefined();
  });
});

describe('company_members', () => {
  it('EMPLOYEE ⇔ có start_date; ADMIN không có', async () => {
    await expect(member({})).rejects.toThrow(/company_members_start_date_chk/);
    await expect(member({ role: 'ADMIN', startDate: day('2026-10-01') })).rejects.toThrow(
      /company_members_start_date_chk/,
    );
    await expect(member({ role: 'ADMIN' })).resolves.toMatchObject({ grants: [] });
  });

  it('grants chỉ cho EMPLOYEE; NULL bị chặn (NOT NULL — D LOW-1)', async () => {
    await expect(member({ role: 'ADMIN', grants: ['HR_MANAGE'] })).rejects.toThrow(
      /company_members_grants_role_chk/,
    );
    await expect(
      prisma.$executeRaw`INSERT INTO company_members (user_id, role, grants, start_date, updated_at)
        VALUES (${ctx.user.id}::uuid, 'EMPLOYEE', NULL, DATE '2026-10-01', now())`,
    ).rejects.toThrow(/null value|not-null/i);
    await expect(
      member({ startDate: day('2026-10-01'), grants: ['HR_MANAGE'] }),
    ).resolves.toBeDefined();
  });

  it('ba cột lịch nghỉ cùng NULL / cùng khác NULL; last_day ≥ start_date (D MEDIUM-1)', async () => {
    const at = new Date('2026-10-21T23:00:00Z');
    await expect(
      member({ startDate: day('2026-10-01'), offboardLastDay: day('2026-10-20') }),
    ).rejects.toThrow(/company_members_offboard_chk/);
    await expect(
      member({
        startDate: day('2026-10-21'),
        offboardLastDay: day('2026-10-20'),
        offboardAccessUntil: at,
        offboardScheduledById: ctx.user.id,
      }),
    ).rejects.toThrow(/company_members_offboard_after_start_chk/);
    await expect(
      member({
        startDate: day('2026-10-20'),
        offboardLastDay: day('2026-10-20'),
        offboardAccessUntil: at,
        offboardScheduledById: ctx.user.id,
      }),
    ).resolves.toBeDefined();
  });

  it('user FK Restrict: không xóa được user còn thuộc công ty', async () => {
    await member({ startDate: day('2026-10-01') });
    await expect(prisma.user.delete({ where: { id: ctx.user.id } })).rejects.toThrow();
  });
});

describe('company_member_departures', () => {
  it('last_day < first_day ⇒ CHECK; cùng ngày hợp lệ', async () => {
    const row = (firstDay: string, lastDay: string) =>
      prisma.companyMemberDeparture.create({
        data: {
          id: randomUUID(),
          userId: ctx.user.id,
          role: 'EMPLOYEE',
          firstDay: day(firstDay),
          lastDay: day(lastDay),
          leftAt: new Date(),
          reason: 'OFFBOARDED',
        },
      });
    await expect(row('2026-10-02', '2026-10-01')).rejects.toThrow(
      /company_member_departures_range_chk/,
    );
    await expect(row('2026-10-01', '2026-10-01')).resolves.toBeDefined();
  });
});

describe('account_activation_tokens (ADR-137)', () => {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const token = (over: Record<string, unknown> = {}) =>
    prisma.accountActivationToken.create({
      data: {
        id: randomUUID(),
        userId: ctx.user.id,
        tokenHash: hash(randomUUID()),
        expiresAt: new Date(Date.now() + 60_000),
        ...over,
      },
    });

  it('token_hash phải là SHA-256 hex (không lưu token thô)', async () => {
    await expect(token({ tokenHash: 'x'.repeat(64) })).rejects.toThrow(
      /account_activation_tokens_hash_chk/,
    );
  });

  it('used_at và revoked_at không cùng có', async () => {
    await expect(token({ usedAt: new Date(), revokedAt: new Date() })).rejects.toThrow(
      /account_activation_tokens_used_or_revoked_chk/,
    );
  });

  it('mỗi user ≤ 1 token sống; token đã thu hồi không giữ chỗ', async () => {
    const first = await token();
    await expect(token()).rejects.toThrow(/account_activation_tokens_live_key|Unique constraint/);
    await prisma.accountActivationToken.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });
    await expect(token()).resolves.toBeDefined();
  });
});
