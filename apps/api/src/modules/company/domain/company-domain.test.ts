import { describe, expect, it } from 'vitest';

import { accessUntilOf, employeeStatusOf, isCompanyAccessActive } from './company-member';
import {
  COMPANY_GRANTS,
  COMPANY_GRANT_PERMISSIONS,
  COMPANY_ROLE_PERMISSIONS,
  canHoldCompanyGrants,
  effectiveCompanyPermissions,
} from './roles';

describe('quyền công ty (ADR-134/135, SEC-HR-34)', () => {
  it('Admin không có *:self; nhân viên không có company:* / hr:manage / payroll:manage', () => {
    expect(COMPANY_ROLE_PERMISSIONS.ADMIN.filter((p) => p.endsWith(':self'))).toEqual([]);
    expect(
      COMPANY_ROLE_PERMISSIONS.EMPLOYEE.filter(
        (p) => p.startsWith('company:') || p === 'hr:manage' || p === 'payroll:manage',
      ),
    ).toEqual([]);
  });

  it('mỗi grant đúng một quyền, không grant nào mở company:*', () => {
    for (const g of COMPANY_GRANTS) {
      expect(COMPANY_GRANT_PERMISSIONS[g]).toHaveLength(1);
      expect(COMPANY_GRANT_PERMISSIONS[g].some((p) => p.startsWith('company:'))).toBe(false);
    }
    expect(COMPANY_GRANT_PERMISSIONS.HR_MANAGE).toEqual(['hr:manage']);
    expect(COMPANY_GRANT_PERMISSIONS.PAYROLL_MANAGE).toEqual(['payroll:manage']);
  });

  it('grant chỉ có tác dụng với EMPLOYEE (dòng ADMIN lỡ có grant không mở thêm gì)', () => {
    expect(canHoldCompanyGrants('EMPLOYEE')).toBe(true);
    expect(canHoldCompanyGrants('ADMIN')).toBe(false);
    expect(effectiveCompanyPermissions('EMPLOYEE', ['HR_MANAGE']).has('hr:manage')).toBe(true);
    expect(effectiveCompanyPermissions('EMPLOYEE', []).has('hr:manage')).toBe(false);
    expect([...effectiveCompanyPermissions('ADMIN', ['HR_MANAGE'])].sort()).toEqual(
      [...COMPANY_ROLE_PERMISSIONS.ADMIN].sort(),
    );
  });
});

describe('hết quyền đúng giờ (ADR-135, CLK-HR-05)', () => {
  it('accessUntilOf = 06:00 ngày sau ngày làm cuối theo múi giờ lịch', () => {
    expect(accessUntilOf('2026-11-20', 'Asia/Ho_Chi_Minh').toISOString()).toBe(
      '2026-11-20T23:00:00.000Z',
    );
    // DST Berlin: 2026-03-29 nhảy giờ ⇒ 06:00 CEST = 04:00Z
    expect(accessUntilOf('2026-03-28', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T04:00:00.000Z',
    );
  });

  it('isCompanyAccessActive: không lịch nghỉ ⇒ còn; trước mốc còn, ĐÚNG mốc thì hết', () => {
    const until = new Date('2026-11-20T23:00:00.000Z');
    expect(isCompanyAccessActive({ offboardAccessUntil: null }, until)).toBe(true);
    expect(
      isCompanyAccessActive({ offboardAccessUntil: until }, new Date(until.getTime() - 1)),
    ).toBe(true);
    expect(isCompanyAccessActive({ offboardAccessUntil: until }, until)).toBe(false);
  });
});

describe('trạng thái suy ra (ADR-133, CO-02)', () => {
  const member = (offboardLastDay: string | null) => ({ offboardLastDay });
  it.each([
    [null, false, false, null],
    [null, true, true, 'LEFT'],
    [member(null), false, false, 'PENDING_ACTIVATION'],
    [member('2026-12-01'), false, false, 'PENDING_ACTIVATION'],
    [member(null), true, false, 'ACTIVE'],
    [member('2026-12-01'), true, false, 'OFFBOARDING'],
  ] as const)('member=%o password=%s departure=%s ⇒ %s', (m, hasPassword, hasDeparture, want) => {
    expect(employeeStatusOf({ member: m, hasPassword, hasDeparture })).toBe(want);
  });
});
