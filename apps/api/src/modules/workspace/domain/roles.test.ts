import { describe, expect, it } from 'vitest';

import {
  ALL_PERMISSIONS,
  GRANT_PERMISSIONS,
  MEMBER_GRANTS,
  ROLE_PERMISSIONS,
  WORKSPACE_ROLES,
  canHoldGrants,
  effectivePermissions,
  isMemberGrant,
  isWorkspaceRole,
  roleAllows,
  type Permission,
} from './roles';

// Bảng chính thức: security.md 3.2. Parity với contracts: application/role-permissions-parity.test.ts.
const EXPECTED: Record<Permission, readonly string[]> = {
  'workspace:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'workspace:update': ['OWNER'],
  'workspace:delete': ['OWNER'],
  'workspace:restore': ['OWNER'],
  'member:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'member:add': ['OWNER', 'PM'],
  'member:update-role': ['OWNER'],
  'member:remove': ['OWNER', 'PM'],
  'member:leave': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'project:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'project:create': ['OWNER', 'PM'],
  'project:update': ['OWNER', 'PM'],
  'project:archive': ['OWNER', 'PM'],
  'task:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'task:create': ['OWNER', 'PM', 'MEMBER'],
  'task:update': ['OWNER', 'PM', 'MEMBER'],
  'task:move': ['OWNER', 'PM', 'MEMBER'],
  'task:assign:any': ['OWNER', 'PM'],
  'task:assign:own': ['MEMBER'],
  'task:delete:any': ['OWNER', 'PM'],
  'task:delete:own': ['MEMBER'],
  'audit:read': ['OWNER', 'PM', 'MEMBER', 'VIEWER'],
  'comment:create': ['OWNER', 'PM', 'MEMBER'],
  'attendance:self': ['OWNER', 'PM', 'MEMBER'],
  'leave:self': ['OWNER', 'PM', 'MEMBER'],
  'hr:manage': ['OWNER'],
  'hr:grant': ['OWNER'],
};

describe('ROLE_PERMISSIONS (security.md 3.2)', () => {
  it('khớp đúng bảng chính thức cho mọi permission × role', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const permission of ALL_PERMISSIONS) {
      const granted = (['OWNER', 'PM', 'MEMBER', 'VIEWER'] as const).filter((role) =>
        ROLE_PERMISSIONS[role].has(permission),
      );
      expect({ permission, granted }).toEqual({ permission, granted: EXPECTED[permission] });
    }
  });

  it('roleAllows: permission cha "task:delete" thỏa khi role có :any HOẶC :own (chặn sớm ở middleware)', () => {
    expect(roleAllows('MEMBER', 'task:delete')).toBe(true);
    expect(roleAllows('PM', 'task:delete')).toBe(true);
    expect(roleAllows('VIEWER', 'task:delete')).toBe(false);
    expect(roleAllows('MEMBER', 'task:assign')).toBe(true);
    expect(roleAllows('VIEWER', 'task:assign')).toBe(false);
  });

  it('roleAllows với permission cụ thể', () => {
    expect(roleAllows('OWNER', 'workspace:delete')).toBe(true);
    expect(roleAllows('PM', 'workspace:delete')).toBe(false);
    expect(roleAllows('MEMBER', 'task:delete:any')).toBe(false);
  });

  it('isWorkspaceRole', () => {
    expect(['OWNER', 'PM', 'MEMBER', 'VIEWER'].every(isWorkspaceRole)).toBe(true);
    expect(isWorkspaceRole('ADMIN')).toBe(false);
    expect(isWorkspaceRole('owner')).toBe(false);
  });
});

describe('grants (ADR-119)', () => {
  it('B-M1: grant KHÔNG BAO GIỜ mở hr:grant / member:* / workspace:* / project:* / task:* (chống leo quyền)', () => {
    const forbidden = /^(hr:grant|member:|workspace:|project:|task:|audit:|comment:)/;
    for (const grant of MEMBER_GRANTS) {
      const opened = [...GRANT_PERMISSIONS[grant]];
      expect(
        opened.filter((p) => forbidden.test(p)),
        grant,
      ).toEqual([]);
    }
    expect([...GRANT_PERMISSIONS.HR_MANAGE]).toEqual(['hr:manage']);
  });

  it('quyền hiệu lực = role ∪ grant; không grant ⇒ đúng bằng role', () => {
    for (const role of WORKSPACE_ROLES) {
      expect(effectivePermissions(role, [])).toEqual(ROLE_PERMISSIONS[role]);
    }
    const memberHr = effectivePermissions('MEMBER', ['HR_MANAGE']);
    expect(memberHr.has('hr:manage')).toBe(true);
    expect(memberHr.has('hr:grant')).toBe(false);
    expect(memberHr.has('member:add')).toBe(false);
    expect([...memberHr].sort()).toEqual([...ROLE_PERMISSIONS.MEMBER, 'hr:manage'].sort());
  });

  it('roleAllows nhận grants: MEMBER + HR_MANAGE có hr:manage, không có hr:grant; PM không grant ⇒ không hr:manage', () => {
    expect(roleAllows('MEMBER', 'hr:manage', ['HR_MANAGE'])).toBe(true);
    expect(roleAllows('MEMBER', 'hr:grant', ['HR_MANAGE'])).toBe(false);
    expect(roleAllows('PM', 'hr:manage')).toBe(false);
    expect(roleAllows('OWNER', 'hr:manage')).toBe(true);
  });

  it('chỉ PM / MEMBER giữ được grant (OWNER có qua role — B-M2; VIEWER không phải nhân viên)', () => {
    expect(WORKSPACE_ROLES.filter(canHoldGrants)).toEqual(['PM', 'MEMBER']);
  });

  it('isMemberGrant', () => {
    expect(isMemberGrant('HR_MANAGE')).toBe(true);
    expect(isMemberGrant('ADMIN')).toBe(false);
  });
});
