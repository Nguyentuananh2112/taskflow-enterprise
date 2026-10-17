// T-054 tầng I (hr-extended ADR-128): `employee_profiles` trên Postgres thật — repo Prisma (tạo / version / đua tạo
// không hủy transaction / gợi ý), CHECK của migration 6, và retention D8 (EP-10): nghỉ 729 ngày giữ, 731 ngày xóa,
// nhận lại giữ, D8 chạy trước D5.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RetentionJob, type RetentionPolicy } from '../../../src/composition/retention-job';
import { prismaRetentionStores } from '../../../src/composition/retention-stores';
import { EMPTY_PROFILE } from '../../../src/modules/hr-profile/domain/employee-profile';
import { PrismaEmployeeProfiles } from '../../../src/modules/hr-profile/infrastructure/prisma/prisma-employee-profiles';
import { FakeClock } from '../../support';
import {
  RecordingUnitOfWork,
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
} from '../support/prisma-test-kit';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const AT = new Date('2026-11-01T00:00:00.000Z');
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const B: RetentionPolicy = {
  clientInfoDays: 395,
  leaveReasonDays: 395,
  recordsDays: 730, // mốc D5 = 2024-12-01
  notificationsDays: 180,
  hrAuditDays: 1826,
};

let hr: string;
const user = async (name: string) =>
  (
    await testPrisma().user.create({
      data: { email: `${name}-${randomUUID()}@example.test`, fullName: name, passwordHash: 'x' },
    })
  ).id;

beforeEach(async () => {
  await resetDatabase();
  hr = await user('hr');
});
afterAll(disconnectTestPrisma);

function repo() {
  const uow = new RecordingUnitOfWork();
  return { uow, profiles: new PrismaEmployeeProfiles(() => uow.db()) };
}

describe('PrismaEmployeeProfiles', () => {
  it('tạo version 1 → sửa version 2; version lệch ⇒ null; đua tạo ⇒ null mà transaction vẫn chạy tiếp', async () => {
    const mia = await user('mia');
    const { uow, profiles } = repo();
    const created = await uow.run(() =>
      profiles.save({
        userId: mia,
        fields: { ...EMPTY_PROFILE, hireDate: '2021-11-17', workPhone: '+84901234567' },
        expectedVersion: 0,
        updatedById: hr,
        at: AT,
      }),
    );
    expect(created).toMatchObject({ hireDate: '2021-11-17', version: 1, updatedById: hr });

    // ON CONFLICT DO NOTHING: không lỗi PK ⇒ câu đọc sau trong CÙNG transaction chạy được.
    const raced = await uow.run(async () => {
      const again = await profiles.save({
        userId: mia,
        fields: EMPTY_PROFILE,
        expectedVersion: 0,
        updatedById: hr,
        at: AT,
      });
      return { again, current: await profiles.findForUpdate(mia) };
    });
    expect(raced.again).toBeNull();
    expect(raced.current?.version).toBe(1);

    const stale = await uow.run(() =>
      profiles.save({
        userId: mia,
        fields: EMPTY_PROFILE,
        expectedVersion: 7,
        updatedById: hr,
        at: AT,
      }),
    );
    expect(stale).toBeNull();
    const updated = await uow.run(() =>
      profiles.save({
        userId: mia,
        fields: { ...EMPTY_PROFILE, department: 'Kho' },
        expectedVersion: 1,
        updatedById: hr,
        at: AT,
      }),
    );
    expect(updated).toMatchObject({ hireDate: null, department: 'Kho', version: 2 });
  });

  it('findMany / suggestions (không trùng, sắp theo tiếng Việt); EP-07 hireDates null khi chưa có hồ sơ', async () => {
    const [a, b, c] = [await user('a'), await user('b'), await user('c')];
    const { uow, profiles } = repo();
    await uow.run(async () => {
      for (const [id, department, jobTitle] of [
        [a, 'Kho', 'Thủ kho'],
        [b, 'Kế toán', 'Thủ kho'],
      ] as const) {
        await profiles.save({
          userId: id,
          fields: { ...EMPTY_PROFILE, department, jobTitle, hireDate: '2025-01-02' },
          expectedVersion: 0,
          updatedById: hr,
          at: AT,
        });
      }
    });
    const many = await uow.run(() => profiles.findMany([a, b, c]));
    expect([...many.keys()].sort()).toEqual([a, b].sort());
    expect(await uow.run(() => profiles.suggestions())).toEqual({
      departments: ['Kế toán', 'Kho'],
      jobTitles: ['Thủ kho'],
    });
  });

  it('CHECK migration 6: hire_date < 1950, phòng ban trắng, SĐT sai mẫu, version 0 ⇒ DB từ chối', async () => {
    const mia = await user('mia');
    const p = testPrisma();
    const base = { userId: mia, updatedById: hr, updatedAt: AT };
    for (const bad of [
      { hireDate: day('1949-12-31') },
      { department: '   ' },
      { jobTitle: '' },
      { workPhone: '090-123' },
      { workPhone: '0901234567x' },
      { version: 0 },
    ]) {
      await expect(p.employeeProfile.create({ data: { ...base, ...bad } })).rejects.toThrow();
    }
    await expect(
      p.employeeProfile.create({
        data: { ...base, hireDate: day('1950-01-01'), workPhone: '+84901234567' },
      }),
    ).resolves.toMatchObject({ version: 1 });
  });
});

describe('EP-10 retention D8 (mốc D5 = 2024-12-01)', () => {
  const departure = (userId: string, lastDay: string) =>
    testPrisma().companyMemberDeparture.create({
      data: {
        id: randomUUID(),
        userId,
        role: 'EMPLOYEE',
        firstDay: day('2020-01-01'),
        lastDay: day(lastDay),
        leftAt: day(lastDay),
        reason: 'OFFBOARDED',
      },
    });
  const profile = (userId: string) =>
    testPrisma().employeeProfile.create({
      data: { userId, hireDate: day('2020-01-01'), updatedById: hr, updatedAt: AT },
    });

  it('nghỉ ngày cuối = mốc giữ, trước mốc 1 ngày xóa; nhận lại / đang làm giữ; departure cũ vẫn bị D5 xóa sau', async () => {
    const [kept, gone, rehired, working] = [
      await user('kept'),
      await user('gone'),
      await user('rehired'),
      await user('working'),
    ];
    await departure(kept, '2024-12-01');
    await departure(gone, '2024-11-30');
    await departure(rehired, '2023-05-31');
    await testPrisma().companyMember.createMany({
      data: [
        { userId: rehired, role: 'EMPLOYEE', startDate: day('2026-06-01') },
        { userId: working, role: 'EMPLOYEE', startDate: day('2026-01-05') },
      ],
    });
    for (const id of [kept, gone, rehired, working]) await profile(id);

    const uow = new RecordingUnitOfWork();
    const stores = prismaRetentionStores(() => uow.db());
    const job = new RetentionJob({ stores, policy: B, uow, clock: new FakeClock(NOW) });
    const res = await job.execute();
    expect(res.rows).toMatchObject({ employee_profiles: 1, member_departures: 2 });

    const left = (await testPrisma().employeeProfile.findMany({ select: { userId: true } })).map(
      (r) => r.userId,
    );
    expect(left.sort()).toEqual([kept, rehired, working].sort());
    // Idempotent.
    expect((await job.execute()).rows).toMatchObject({ employee_profiles: 0 });
  });
});
