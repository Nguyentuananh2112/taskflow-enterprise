// Xóa sạch dữ liệu seed rồi dựng lại các dòng MIGRATION chèn sẵn mà TRUNCATE … CASCADE cuốn theo (bug 500 ngày 18/10:
// `payroll_settings.updated_by_id → users` ⇒ CASCADE xóa singleton lương). Rà migration: chỉ `companies` (id 1) và
// `payroll_settings` (id 1) là dòng cố định; backfill `company_members` của migration công ty được seed tạo lại theo người.
import type { PrismaClient } from '../src/generated/prisma/client';
import {
  DEFAULT_SENIORITY_PER_YEAR,
  PAYROLL_SETTINGS_ID,
} from '../src/modules/payroll/domain/payroll-settings';

export const SEED_TABLES =
  'notifications, hr_audit_logs, leave_requests, leave_balances, attendance_events, holidays, work_schedules, ' +
  'account_activation_tokens, company_member_departures, company_members, companies, task_audit_logs, tasks, ' +
  'projects, workspace_members, refresh_tokens, workspaces, payroll_settings, users';

export async function resetSeedTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${SEED_TABLES} CASCADE`);
  await prisma.company.create({ data: { id: 1, name: 'Công ty Mẫu' } });
  await prisma.payrollSettings.create({
    data: { id: PAYROLL_SETTINGS_ID, seniorityPerYear: BigInt(DEFAULT_SENIORITY_PER_YEAR) },
  });
}
