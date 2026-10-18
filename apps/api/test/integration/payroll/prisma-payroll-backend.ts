// Backend Postgres cho harness payroll (LSP T-049, như attendance): cùng hợp đồng `PayrollBackend` với bản in-memory ⇒
// chạy lại nguyên bộ test use case tầng A trên `PrismaPayrollStore` + PrismaUnitOfWork + migration 7 thật (trigger
// bất biến sau phát hành, partial unique bản hiệu lực, CHECK).
import { PrismaPayrollStore } from '../../../src/modules/payroll/infrastructure/prisma/prisma-payroll.store';
import { NAMES } from '../../../src/modules/payroll/testing/payroll-fixture';
import type { PayrollBackend } from '../../../src/modules/payroll/testing/payroll-harness';
import { RecordingUnitOfWork, resetDatabase, testPrisma } from '../support/prisma-test-kit';

/** Ghi lại khóa đã lấy (test khẳng định `h.store.locks`) rồi lấy khóa advisory thật. */
class LockRecordingPayrollStore extends PrismaPayrollStore {
  readonly locks: string[] = [];

  override async lockPeriod(period: string): Promise<void> {
    this.locks.push(`taskflow:payroll:${period}`);
    await super.lockPeriod(period);
  }
}

export function prismaPayrollBackend(): PayrollBackend {
  const uow = new RecordingUnitOfWork();
  return { uow, store: new LockRecordingPayrollStore(() => uow.db()) };
}

/** DB sạch + dòng `payroll_settings` của migration (TRUNCATE users CASCADE kéo theo) + người của bối cảnh chuẩn. */
export async function resetPayrollDatabase(): Promise<void> {
  await resetDatabase();
  const p = testPrisma();
  await p.$executeRawUnsafe(
    `INSERT INTO payroll_settings (id, seniority_per_year, version, updated_by_id, updated_at)
     VALUES (1, 500000, 1, NULL, now()) ON CONFLICT (id) DO NOTHING`,
  );
  for (const [id, fullName] of Object.entries(NAMES)) {
    await p.user.create({ data: { id, email: `${id}@example.test`, fullName, passwordHash: 'x' } });
  }
}
