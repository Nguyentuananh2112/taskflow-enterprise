import { Uuid } from '@taskflow/contracts/common';
import {
  AccessDto,
  AssignWorkspaceOwnerBody,
  CompanyDto,
  SetAccessBody,
  UpdateCompanyBody,
} from '@taskflow/contracts/company';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import { AdminWorkspaceWithMembersDto } from '@/shared/api/pending-contracts/company';

import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import { fail, ok, parseBody } from './respond';

// Quản trị (ADR-134, company-level.md §4 — `company:admin` / `company:grant`): phân quyền (role + grants, expectedVersion,
// ≥ 1 Admin luôn còn), danh sách workspace (không nội dung dự án), giao OWNER cho workspace mồ côi (người nhận là
// thành viên còn lại), lưu trữ workspace mồ côi không còn ai, tên công ty.

export function createAdminHandlers(baseUrl: string, db: MockDb): HttpHandler[] {
  const company = db.company;
  const companyDto = () => ({
    name: company.name,
    version: company.version,
    privacyContact: company.privacyContact,
  });
  const access = (userId: string): AccessDto | undefined => {
    const user = db.getUser(userId);
    const row = company.row(userId);
    if (!user || !row) return undefined;
    const status =
      user.password === '' ? 'PENDING_ACTIVATION' : row.offboardLastDay ? 'OFFBOARDING' : 'ACTIVE';
    return {
      userId,
      fullName: user.fullName,
      email: user.email,
      role: row.role,
      grants: [...row.grants],
      status,
      version: row.version,
    };
  };
  const workspace = (id: string): AdminWorkspaceWithMembersDto | undefined => {
    const row = db.workspaces.all().find((w) => w.id === id);
    if (!row) return undefined;
    const members = db.workspaces.membersOf(id);
    const owners = members
      .filter((m) => m.role === 'OWNER')
      .map((m) => ({
        id: m.userId,
        fullName: db.getUser(m.userId)?.fullName ?? 'Người dùng đã xóa',
      }));
    return {
      id,
      name: row.name,
      owners,
      memberCount: members.length,
      orphan: owners.length === 0,
      // TL chốt: mồ côi ⇒ kèm thành viên còn lại (chỉ tên) để Admin giao OWNER.
      ...(owners.length === 0
        ? {
            members: members.map((m) => ({
              userId: m.userId,
              fullName: db.getUser(m.userId)?.fullName ?? 'Người dùng đã xóa',
            })),
          }
        : {}),
      deletedAt: row.deletedAt,
      archivedAt: row.archivedAt ?? null,
    };
  };
  const conflict = (reason: string) => fail(409, 'RESOURCE_CONFLICT', { reason });

  return [
    http.get(`${baseUrl}/admin/access`, ({ request }) => {
      const ctx = requireCompany(request, db, 'company:admin');
      if (ctx.response) return ctx.response;
      const rows = company
        .members()
        .flatMap(([id]) => access(id) ?? [])
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
      return ok(z.array(AccessDto), rows);
    }),

    http.put(`${baseUrl}/admin/access/:userId`, async ({ request, params }) => {
      const ctx = requireCompany(request, db, 'company:grant');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, SetAccessBody);
      if (body.response) return body.response;
      const id = Uuid.safeParse(params.userId);
      const current = id.success ? access(id.data) : undefined;
      if (!current) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
      const { role, grants, expectedVersion } = body.data;
      if (current.version !== expectedVersion) return fail(409, 'VERSION_CONFLICT');
      if (role === 'ADMIN' && grants.length > 0) {
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'GRANT_NOT_ALLOWED' });
      }
      const admins = company.members().filter(([, r]) => r.role === 'ADMIN').length;
      if (current.role === 'ADMIN' && role !== 'ADMIN' && admins <= 1)
        return conflict('last_admin');
      company.setAccess(current.userId, role, grants);
      const after = access(current.userId);
      return after ? ok(AccessDto, after) : fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
    }),

    http.get(`${baseUrl}/admin/workspaces`, ({ request }) => {
      const ctx = requireCompany(request, db, 'company:admin');
      if (ctx.response) return ctx.response;
      const rows = db.workspaces
        .all()
        .flatMap((w) => workspace(w.id) ?? [])
        // Mồ côi lên đầu — việc Admin cần làm.
        .sort((a, b) => Number(b.orphan) - Number(a.orphan) || a.name.localeCompare(b.name, 'vi'));
      return ok(z.array(AdminWorkspaceWithMembersDto), rows);
    }),

    http.post(`${baseUrl}/admin/workspaces/:id/owner`, async ({ request, params }) => {
      const ctx = requireCompany(request, db, 'company:admin');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, AssignWorkspaceOwnerBody);
      if (body.response) return body.response;
      const id = Uuid.safeParse(params.id);
      const ws = id.success ? workspace(id.data) : undefined;
      if (!ws) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'workspace' });
      if (ws.deletedAt) return conflict('workspace_deleted');
      if (!ws.orphan) return conflict('workspace_has_owner');
      // v2.1: chỉ giao cho thành viên CÒN LẠI của workspace (Admin không tự vào ws mình không ở).
      if (!db.workspaces.member(ws.id, body.data.userId) || !company.row(body.data.userId)) {
        return fail(422, 'BUSINESS_RULE_VIOLATION', { rule: 'NOT_WORKSPACE_MEMBER' });
      }
      db.workspaces.setMember(ws.id, body.data.userId, 'OWNER');
      return ok(AdminWorkspaceWithMembersDto, workspace(ws.id) ?? ws);
    }),

    http.post(`${baseUrl}/admin/workspaces/:id/archive`, ({ request, params }) => {
      const ctx = requireCompany(request, db, 'company:admin');
      if (ctx.response) return ctx.response;
      const id = Uuid.safeParse(params.id);
      const ws = id.success ? workspace(id.data) : undefined;
      if (!ws) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'workspace' });
      if (ws.memberCount > 0) return conflict('workspace_has_members');
      db.workspaces.archive(ws.id);
      return ok(AdminWorkspaceWithMembersDto, workspace(ws.id) ?? ws);
    }),

    http.get(`${baseUrl}/company`, ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      return ok(CompanyDto, companyDto());
    }),

    http.patch(`${baseUrl}/company`, async ({ request }) => {
      const ctx = requireCompany(request, db, 'company:admin');
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, UpdateCompanyBody);
      if (body.response) return body.response;
      if (body.data.expectedVersion !== company.version) return fail(409, 'VERSION_CONFLICT');
      const { name, privacyContact } = body.data;
      if (name !== undefined) company.name = name;
      // T-075: chuỗi rỗng / null ⇒ xóa đầu mối.
      if (privacyContact !== undefined) company.privacyContact = privacyContact || null;
      company.version += 1;
      return ok(CompanyDto, companyDto());
    }),
  ];
}
