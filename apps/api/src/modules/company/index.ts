// Public API của module company (ADR-093): CHỈ export TYPE. Module khác (attendance, leave, workspace, payroll)
// khai báo port của riêng mình và `implements` khớp cấu trúc; composition root nối bản thật.
export type { CompanyAccess, CompanyWriteInput } from './application/company-access';
export type {
  CompanyActor,
  CompanyTenure,
  CompanyTenureQuery,
  ICompanyMemberRepository,
  ICompanyTenureReader,
} from './application/ports/company-member.port';
export type { CompanyMemberSnapshot, EmployeeStatus } from './domain/company-member';
export type { CompanyGrant, CompanyPermission, CompanyRole } from './domain/roles';
