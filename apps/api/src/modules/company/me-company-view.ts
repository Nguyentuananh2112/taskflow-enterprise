import type { CompanyGrant, CompanyPermission, CompanyRole } from './domain/roles';

/** Khớp cấu trúc `MeCompanyDto` (contracts) — `GET /auth/me`. */
export interface MeCompanyView {
  name: string | null;
  role: CompanyRole;
  grants: CompanyGrant[];
  permissions: CompanyPermission[];
  status: 'ACTIVE' | 'OFFBOARDING';
  offboardLastDay: string | null;
}
