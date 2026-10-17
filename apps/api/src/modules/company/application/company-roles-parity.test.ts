import {
  COMPANY_GRANT_PERMISSIONS as CONTRACT_GRANTS,
  COMPANY_ROLE_PERMISSIONS as CONTRACT_ROLES,
  CompanyGrant,
  CompanyPermission,
  CompanyRole,
  effectiveCompanyPermissions as contractEffective,
} from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  COMPANY_GRANTS,
  COMPANY_GRANT_PERMISSIONS,
  COMPANY_PERMISSIONS,
  COMPANY_ROLES,
  COMPANY_ROLE_PERMISSIONS,
  effectiveCompanyPermissions,
  type CompanyGrant as DomainGrant,
} from '../domain/roles';

// ADR-080: domain là nguồn sự thật, contracts giữ bản sao dạng dữ liệu cho FE. Đặt ở application vì domain không
// được import contracts (ADR-043).
describe('Parity quyền công ty: domain ↔ @taskflow/contracts', () => {
  it('cùng tập role / grant / permission', () => {
    expect([...COMPANY_ROLES]).toEqual([...CompanyRole.options]);
    expect([...COMPANY_GRANTS]).toEqual([...CompanyGrant.options]);
    expect([...COMPANY_PERMISSIONS].sort()).toEqual([...CompanyPermission.options].sort());
  });

  it.each(COMPANY_ROLES)('%s có đúng cùng tập quyền', (role) => {
    expect([...COMPANY_ROLE_PERMISSIONS[role]].sort()).toEqual([...CONTRACT_ROLES[role]].sort());
  });

  it.each(COMPANY_GRANTS)('%s mở đúng cùng tập quyền', (grant) => {
    expect([...COMPANY_GRANT_PERMISSIONS[grant]].sort()).toEqual(
      [...CONTRACT_GRANTS[grant]].sort(),
    );
  });
});

/** Mọi tập con của grant (2 grant ⇒ 4 tổ hợp). */
const GRANT_SETS: DomainGrant[][] = [
  [],
  ['HR_MANAGE'],
  ['PAYROLL_MANAGE'],
  ['HR_MANAGE', 'PAYROLL_MANAGE'],
];

describe('CO-01 effectiveCompanyPermissions — mọi tổ hợp role × grants (test-spec-company §2)', () => {
  const expected = (role: 'ADMIN' | 'EMPLOYEE', grants: readonly DomainGrant[]) =>
    role === 'ADMIN'
      ? ['company:admin', 'company:grant', 'hr:manage', 'payroll:manage', 'workspace:create']
      : [
          'attendance:self',
          'leave:self',
          'workspace:create',
          ...(grants.includes('HR_MANAGE') ? ['hr:manage'] : []),
          ...(grants.includes('PAYROLL_MANAGE') ? ['payroll:manage'] : []),
        ];

  for (const role of COMPANY_ROLES) {
    for (const grants of GRANT_SETS) {
      it(`${role} + [${grants.join(', ')}]`, () => {
        const domain = [...effectiveCompanyPermissions(role, grants)].sort();
        expect(domain).toEqual(expected(role, grants).sort());
        // Parity: web tính quyền bằng hàm của contracts — phải ra đúng cùng tập.
        expect([...contractEffective(role, grants)].sort()).toEqual(domain);
        // ADMIN không bao giờ có `*:self`; grant không bao giờ mở `company:*`.
        if (role === 'ADMIN') expect(domain.some((p) => p.endsWith(':self'))).toBe(false);
        else expect(domain.some((p) => p.startsWith('company:'))).toBe(false);
      });
    }
  }
});
