import { describe, expect, it } from 'vitest';

import {
  ActivateBody,
  COMPANY_GRANT_PERMISSIONS,
  COMPANY_ROLE_PERMISSIONS,
  CompanyConflictReason,
  CompanyGrant,
  HireEmployeeBody,
  MemberCandidatesQuery,
  SetAccessBody,
  effectiveCompanyPermissions,
} from './index';

const ID = '0199e5a2-7c1e-7cc3-9a3b-000000000001';

describe('ma trận quyền công ty (ADR-134/135)', () => {
  it('Admin không có *:self (không chấm công / xin nghỉ); nhân viên không có company:* / hr / payroll', () => {
    expect(COMPANY_ROLE_PERMISSIONS.ADMIN.some((p) => p.endsWith(':self'))).toBe(false);
    expect(COMPANY_ROLE_PERMISSIONS.EMPLOYEE).toEqual([
      'attendance:self',
      'leave:self',
      'profile:self',
      'payslip:self',
      'workspace:create',
    ]);
  });

  it('mỗi grant mở đúng một quyền; không grant nào chứa company:*', () => {
    expect(COMPANY_GRANT_PERMISSIONS).toEqual({
      HR_MANAGE: ['hr:manage'],
      PAYROLL_MANAGE: ['payroll:manage'],
    });
    for (const g of CompanyGrant.options) {
      expect(COMPANY_GRANT_PERMISSIONS[g].some((p) => p.startsWith('company:'))).toBe(false);
    }
  });

  it('quyền hiệu lực = role ∪ grants', () => {
    expect([...effectiveCompanyPermissions('EMPLOYEE', ['HR_MANAGE'])].sort()).toEqual(
      [
        'attendance:self',
        'hr:manage',
        'leave:self',
        'profile:self',
        'payslip:self',
        'workspace:create',
      ].sort(),
    );
  });
});

describe('body strict (SEC-HR-30/65)', () => {
  it('HireEmployeeBody: chuẩn hóa email; có role / grants / userId ⇒ lỗi', () => {
    expect(HireEmployeeBody.parse({ email: ' Mia@X.VN ', fullName: 'Mia' }).email).toBe('mia@x.vn');
    for (const extra of [{ role: 'ADMIN' }, { grants: ['HR_MANAGE'] }, { userId: ID }]) {
      expect(HireEmployeeBody.safeParse({ email: 'a@x.vn', fullName: 'A', ...extra }).success).toBe(
        false,
      );
    }
  });

  it('SetAccessBody: không nhận joinedAt; grant lạ ⇒ lỗi', () => {
    const ok = { role: 'EMPLOYEE', grants: ['HR_MANAGE'], expectedVersion: 1 };
    expect(SetAccessBody.safeParse(ok).success).toBe(true);
    expect(SetAccessBody.safeParse({ ...ok, joinedAt: '2026-01-01' }).success).toBe(false);
    expect(SetAccessBody.safeParse({ ...ok, grants: ['ROOT'] }).success).toBe(false);
  });

  it('ActivateBody: token không ràng định dạng (server trả cùng ACTIVATION_INVALID); body lạ ⇒ lỗi', () => {
    expect(ActivateBody.safeParse({ token: 'x', password: 'mật khẩu đủ dài 12' }).success).toBe(
      true,
    );
    expect(
      ActivateBody.safeParse({ token: 'x', password: 'mật khẩu đủ dài 12', email: 'a@x.vn' })
        .success,
    ).toBe(false);
  });

  it('MemberCandidatesQuery: q 2..100 ký tự', () => {
    expect(MemberCandidatesQuery.safeParse({ q: 'a' }).success).toBe(false);
    expect(MemberCandidatesQuery.safeParse({ q: 'mi' }).success).toBe(true);
    expect(MemberCandidatesQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });

  it('lý do 409 viết thường', () => {
    expect(CompanyConflictReason.options.every((r) => r === r.toLowerCase())).toBe(true);
  });
});
