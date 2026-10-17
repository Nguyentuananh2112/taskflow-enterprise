import { HrAuditAction as ContractHrAuditAction } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { HR_AUDIT_ACTIONS } from '../domain/hr-audit';

// ADR-080: domain là nguồn sự thật cho tập hành động HrAuditLog; contracts giữ bản sao cho FE / DTO.
// Đặt ở application vì domain không được import contracts (ADR-043).
describe('Parity: domain HR_AUDIT_ACTIONS ↔ @taskflow/contracts HrAuditAction', () => {
  it('cùng tập, cùng thứ tự', () => {
    expect([...HR_AUDIT_ACTIONS]).toEqual([...ContractHrAuditAction.options]);
  });
});
