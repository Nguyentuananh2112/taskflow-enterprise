// PATCH /company tầng I (ADR-010/133): `PrismaCompany.rename` chỉ ghi khi `version` khớp, tăng version, đúng một
// dòng; chưa có dòng ⇒ null; tên rỗng sau trim bị CHECK chặn ở DB (chốt cuối khi app quên validate).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaCompany } from '../../src/modules/company/infrastructure/prisma/prisma-company';
import { createTestPrisma, truncateAll } from './db';

const prisma: PrismaClient = createTestPrisma();
const repo = new PrismaCompany(() => prisma);
const at = new Date('2026-11-18T03:00:00.000Z');

beforeEach(async () => {
  await truncateAll(prisma);
});
afterAll(() => prisma.$disconnect());

describe('PrismaCompany.rename', () => {
  it('chưa có dòng ⇒ null; version khớp ⇒ tên mới + version 2; version cũ ⇒ null, không đổi', async () => {
    expect(await repo.rename({ name: 'X', expectedVersion: 1, at })).toBeNull();
    await repo.ensure('Công ty Mẫu', at);
    expect(await repo.rename({ name: 'Công ty Mới', expectedVersion: 1, at })).toEqual({
      name: 'Công ty Mới',
      version: 2,
    });
    expect(await repo.rename({ name: 'Lần 2', expectedVersion: 1, at })).toBeNull();
    expect(await repo.get()).toEqual({ name: 'Công ty Mới', version: 2 });
    expect(await prisma.company.count()).toBe(1);
  });

  it('tên chỉ có khoảng trắng ⇒ CHECK companies_name_not_blank_chk', async () => {
    await repo.ensure('Công ty Mẫu', at);
    await expect(repo.rename({ name: '   ', expectedVersion: 1, at })).rejects.toThrow(
      /companies_name_not_blank_chk/,
    );
  });
});
