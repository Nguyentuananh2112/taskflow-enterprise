import {
  COMPANY_GRANT_PERMISSIONS as CONTRACT_GRANTS,
  COMPANY_ROLE_PERMISSIONS as CONTRACT_ROLES,
  CompanyGrant,
  CompanyPermission,
  CompanyRole,
} from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  COMPANY_GRANTS,
  COMPANY_GRANT_PERMISSIONS,
  COMPANY_PERMISSIONS,
  COMPANY_ROLES,
  COMPANY_ROLE_PERMISSIONS,
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
