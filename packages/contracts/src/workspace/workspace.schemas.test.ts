import { describe, expect, it } from 'vitest';

import {
  AddMemberBody,
  ChangeMemberRoleBody,
  CreateWorkspaceBody,
  DeleteWorkspaceBody,
  ListMembersQuery,
  ListWorkspacesQuery,
  MemberParams,
  UpdateWorkspaceBody,
  WorkspaceName,
  WorkspaceSlug,
} from '../index';

const ID = '0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a';

describe('WorkspaceSlug (R19, ADR-094)', () => {
  it.each(['abc', 'nguyen-van-duc', 'w1', 'a'.repeat(50)].filter((s) => s.length >= 3))(
    'chấp nhận %s',
    (slug) => expect(WorkspaceSlug.safeParse(slug).success).toBe(true),
  );
  it.each(['ab', 'a'.repeat(51), 'ABC', 'a--b', '-ab', 'ab-', 'a_b', 'đức'])('từ chối %s', (slug) =>
    expect(WorkspaceSlug.safeParse(slug).success).toBe(false),
  );
});

describe('WorkspaceName', () => {
  it('trim, 1–100', () => {
    expect(WorkspaceName.parse('  Công ty A ')).toBe('Công ty A');
    expect(WorkspaceName.safeParse('').success).toBe(false);
    expect(WorkspaceName.safeParse('x'.repeat(101)).success).toBe(false);
  });
});

describe('body workspace', () => {
  it('CreateWorkspaceBody: slug tùy chọn', () => {
    expect(CreateWorkspaceBody.safeParse({ name: 'W' }).success).toBe(true);
    expect(CreateWorkspaceBody.safeParse({ name: 'W', slug: 'Bad' }).success).toBe(false);
  });
  it('UpdateWorkspaceBody cần ít nhất một trường', () => {
    expect(UpdateWorkspaceBody.safeParse({}).success).toBe(false);
    expect(UpdateWorkspaceBody.safeParse({ slug: 'new-slug' }).success).toBe(true);
  });
  it('DeleteWorkspaceBody bắt buộc confirmSlug', () => {
    expect(DeleteWorkspaceBody.safeParse({}).success).toBe(false);
    expect(DeleteWorkspaceBody.safeParse({ confirmSlug: 'w-1' }).success).toBe(true);
  });
  it('ListWorkspacesQuery chỉ nhận deleted=true', () => {
    expect(ListWorkspacesQuery.parse({})).toEqual({});
    expect(ListWorkspacesQuery.safeParse({ deleted: 'true' }).success).toBe(true);
    expect(ListWorkspacesQuery.safeParse({ deleted: 'false' }).success).toBe(false);
  });
});

describe('member', () => {
  it('MemberParams yêu cầu uuid', () => {
    expect(MemberParams.safeParse({ wsId: ID, userId: ID }).success).toBe(true);
    expect(MemberParams.safeParse({ wsId: ID, userId: '1' }).success).toBe(false);
  });
  it('ListMembersQuery: q rỗng ⇒ không lọc, q quá 100 ⇒ lỗi, limit mặc định 50', () => {
    expect(ListMembersQuery.parse({ q: '  ' })).toEqual({ q: undefined, limit: 50 });
    expect(ListMembersQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(ListMembersQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
  it('AddMemberBody (Mốc 3.5): chọn theo userId; email tự do / role lạ ⇒ lỗi', () => {
    expect(AddMemberBody.safeParse({ userId: ID, role: 'MEMBER' }).success).toBe(true);
    expect(AddMemberBody.safeParse({ email: 'max@x.vn', role: 'MEMBER' }).success).toBe(false);
    expect(AddMemberBody.safeParse({ userId: ID, role: 'ADMIN' }).success).toBe(false);
  });
  it('ChangeMemberRoleBody strict', () => {
    expect(ChangeMemberRoleBody.safeParse({ role: 'VIEWER' }).success).toBe(true);
    expect(ChangeMemberRoleBody.safeParse({ role: 'VIEWER', userId: ID }).success).toBe(false);
  });
});
