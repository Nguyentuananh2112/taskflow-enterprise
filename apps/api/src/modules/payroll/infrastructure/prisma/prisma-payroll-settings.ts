import type { ILogger } from '../../../../core/logging/logger';
import type { Prisma } from '../../../../generated/prisma/client';
import { DEFAULT_SENIORITY_PER_YEAR, PAYROLL_SETTINGS_ID } from '../../domain/payroll-settings';
import { fromBig } from './prisma-payroll-mapping';

/**
 * Đọc dòng `payroll_settings` duy nhất. Thiếu (bị xóa ngoài ý muốn — vd seed TRUNCATE … CASCADE, bug 500 ngày 18/10) ⇒
 * TẠO LẠI giá trị mặc định của migration (`ON CONFLICT DO NOTHING` — hai request đồng thời không làm hỏng transaction)
 * + log warn, KHÔNG 500 câm. Không có trạng thái "thiếu" hợp lệ: mặc định là xác định, Kế toán đổi lại được (có audit).
 */
export async function readPayrollSettings(
  db: Prisma.TransactionClient,
  logger?: Pick<ILogger, 'warn'>,
) {
  const where = { id: PAYROLL_SETTINGS_ID };
  let s = await db.payrollSettings.findUnique({ where });
  if (!s) {
    await db.payrollSettings.createMany({
      data: [{ id: PAYROLL_SETTINGS_ID, seniorityPerYear: BigInt(DEFAULT_SENIORITY_PER_YEAR) }],
      skipDuplicates: true,
    });
    logger?.warn({ table: 'payroll_settings' }, 'payroll.settings_restored_default');
    s = await db.payrollSettings.findUniqueOrThrow({ where });
  }
  return {
    seniorityPerYear: fromBig(s.seniorityPerYear),
    version: s.version,
    updatedAt: s.updatedAt,
    updatedById: s.updatedById,
  };
}
