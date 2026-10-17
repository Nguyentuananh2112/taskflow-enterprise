// CO-03 tầng I: nhiệm kỳ theo NGÀY trên Postgres thật — `PrismaCompanyTenureReader.tenuresOf` cho người vào → nghỉ →
// nhận lại (một departure OFFBOARDED + dòng EMPLOYEE hiện tại với start_date mới) ⇒ đúng 2 đoạn; khoảng giữa ⇒ [];
// departure ROLE_CHANGED của Admin không phải nhiệm kỳ nhân viên. Bản InMemory: company/testing/company-access.test.ts.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaCompanyTenureReader } from '../../../src/modules/company/infrastructure/prisma/prisma-company';
import { disconnectTestPrisma, resetDatabase, testPrisma } from '../support/prisma-test-kit';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

let gone: string;
let ada: string;
const reader = new PrismaCompanyTenureReader(() => testPrisma());

beforeEach(async () => {
  await resetDatabase();
  const p = testPrisma();
  const user = async (name: string) =>
    (
      await p.user.create({
        data: { email: `${name}-${randomUUID()}@example.test`, fullName: name, passwordHash: 'x' },
      })
    ).id;
  gone = await user('gone');
  ada = await user('ada');
  await p.companyMemberDeparture.createMany({
    data: [
      {
        id: randomUUID(),
        userId: gone,
        role: 'EMPLOYEE',
        firstDay: day('2025-03-01'),
        lastDay: day('2026-06-30'),
        leftAt: new Date('2026-06-30T23:00:00.000Z'),
        reason: 'OFFBOARDED',
      },
      {
        id: randomUUID(),
        userId: ada,
        role: 'EMPLOYEE',
        firstDay: day('2026-01-05'),
        lastDay: day('2026-02-10'),
        leftAt: new Date('2026-02-10T03:00:00.000Z'),
        reason: 'ROLE_CHANGED',
      },
    ],
  });
  await p.companyMember.createMany({
    data: [
      { userId: gone, role: 'EMPLOYEE', startDate: day('2026-09-01') },
      { userId: ada, role: 'ADMIN' },
    ],
  });
});
afterAll(disconnectTestPrisma);

describe('CO-03 PrismaCompanyTenureReader — vào → nghỉ → nhận lại', () => {
  it('2 đoạn: đoạn cũ đóng ở last_day, đoạn mới từ start_date mới (mở); truy vấn trong khoảng giữa ⇒ []', async () => {
    const all = await reader.tenuresOf({ userIds: [gone], from: '2025-01-01', to: '2026-12-31' });
    expect(all.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { userId: gone, from: '2025-03-01', until: '2026-06-30' },
      { userId: gone, from: '2026-09-01', until: null },
    ]);
    expect(
      await reader.tenuresOf({ userIds: [gone], from: '2026-07-01', to: '2026-08-31' }),
    ).toEqual([]);
    // Biên: last_day và start_date mới đều nằm TRONG nhiệm kỳ (so theo ngày, gồm hai đầu).
    expect(
      await reader.tenuresOf({ userIds: [gone], from: '2026-06-30', to: '2026-06-30' }),
    ).toEqual([{ userId: gone, from: '2025-03-01', until: '2026-06-30' }]);
    expect(
      await reader.tenuresOf({ userIds: [gone], from: '2026-09-01', to: '2026-09-01' }),
    ).toEqual([{ userId: gone, from: '2026-09-01', until: null }]);
  });

  it('Admin (nâng từ nhân viên): chỉ đoạn nhân viên cũ (departure ROLE_CHANGED role EMPLOYEE), không có đoạn mở', async () => {
    expect(
      await reader.tenuresOf({ userIds: [ada], from: '2026-01-01', to: '2026-12-31' }),
    ).toEqual([{ userId: ada, from: '2026-01-05', until: '2026-02-10' }]);
  });
});
