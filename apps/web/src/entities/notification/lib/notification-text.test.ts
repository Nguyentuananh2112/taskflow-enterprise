import type { NotificationDto } from '@taskflow/contracts/hr';
import { describe, expect, it } from 'vitest';

import { notificationHref } from './notification-text';

const base: NotificationDto = {
  id: '0199e5a2-7c1e-7cc3-9a3b-000000000001',
  type: 'PAYSLIP_PUBLISHED',
  refId: '0199e5a2-7c1e-7cc3-9a3b-000000000002',
  actor: null,
  leave: null,
  payslip: { period: '2026-09' },
  readAt: null,
  createdAt: '2026-10-08T03:00:00.000Z',
};

describe('notificationHref — phiếu lương (T-050)', () => {
  it('PUBLISHED / REVISED có kỳ ⇒ /payslips/YYYY-MM; thiếu kỳ ⇒ /payslips; REMINDER ⇒ /payroll', () => {
    expect(notificationHref(base)).toBe('/payslips/2026-09');
    expect(notificationHref({ ...base, type: 'PAYSLIP_REVISED' })).toBe('/payslips/2026-09');
    expect(notificationHref({ ...base, payslip: null })).toBe('/payslips');
    expect(notificationHref({ ...base, type: 'PAYROLL_REMINDER', payslip: null })).toBe('/payroll');
  });
});
