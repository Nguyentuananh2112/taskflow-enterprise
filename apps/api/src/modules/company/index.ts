// Public API của module company (ADR-093): CHỈ export TYPE. Module khác (attendance, leave, workspace, payroll)
// khai báo port của riêng mình và `implements` khớp cấu trúc; composition root nối bản thật.
export type { CompanyAccess, CompanyWriteInput } from './application/company-access';
export type { HrAuditInput, HrAuditWriter } from './application/hr-audit-writer';
export type { HrAuditAction } from './domain/hr-audit';
export type { CompanyModule, MeCompanyView } from './company.module';
export type { ICompanyAccounts } from './application/ports/accounts.port';
export type {
  CompanyActor,
  CompanyProfile,
  ICompanyRepository,
  CompanyTenure,
  CompanyTenureQuery,
  ICompanyMemberRepository,
  ICompanyTenureReader,
} from './application/ports/company-member.port';
export type { CompanyMemberSnapshot, EmployeeStatus } from './domain/company-member';
export type { CompanyGrant, CompanyPermission, CompanyRole } from './domain/roles';
