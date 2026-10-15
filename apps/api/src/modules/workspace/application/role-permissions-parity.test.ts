import { ROLE_PERMISSIONS as CONTRACT_ROLE_PERMISSIONS } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { ALL_PERMISSIONS, ROLE_PERMISSIONS, WORKSPACE_ROLES } from '../domain/roles';

// ADR-080: domain là nguồn sự thật, contracts giữ bản sao dạng dữ liệu cho FE — test parity
// bắt buộc trong CI. Đặt ở application vì domain không được import contracts (ADR-043).
describe('Parity: domain ROLE_PERMISSIONS ↔ @taskflow/contracts ROLE_PERMISSIONS', () => {
  it.each(WORKSPACE_ROLES)('%s có đúng cùng một tập permission ở hai bên', (role) => {
    const domain = [...ROLE_PERMISSIONS[role]].sort();
    const contract = [...CONTRACT_ROLE_PERMISSIONS[role]].sort();
    expect(domain).toEqual(contract);
  });

  it('không có permission nào chỉ tồn tại ở một bên', () => {
    const contractAll = new Set(WORKSPACE_ROLES.flatMap((r) => [...CONTRACT_ROLE_PERMISSIONS[r]]));
    const domainGranted = new Set(WORKSPACE_ROLES.flatMap((r) => [...ROLE_PERMISSIONS[r]]));
    expect([...domainGranted].sort()).toEqual([...contractAll].sort());
    expect([...ALL_PERMISSIONS].sort()).toEqual([...contractAll].sort());
  });
});
