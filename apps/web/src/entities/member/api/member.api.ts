import {
  ChangeMemberRoleResponse,
  MemberDto,
  RemoveMemberResponse,
  type AddMemberBody,
} from '@taskflow/contracts/workspace';
import type { MemberGrant, WorkspaceRole } from '@taskflow/contracts/rbac';
import * as z from 'zod';

import { http } from '@/shared/api';

const MemberList = z.array(MemberDto);
const base = (wsId: string) => `/workspaces/${encodeURIComponent(wsId)}/members`;
const one = (wsId: string, userId: string) => `${base(wsId)}/${encodeURIComponent(userId)}`;

export const memberApi = {
  /** Một trang thành viên; `q` lọc theo tên/email phía server (ADR-083). */
  list: (wsId: string, params: Readonly<{ q?: string; limit?: number }> = {}) =>
    http.get(base(wsId), {
      schema: MemberList,
      query: { q: params.q || undefined, limit: params.limit ?? 50 },
    }),
  /** Trang theo cursor (bảng thành viên). */
  page: (wsId: string, q: string, cursor?: string) =>
    http.request('GET', base(wsId), {
      schema: MemberList,
      query: { q: q || undefined, limit: 50, cursor },
    }),
  add: (wsId: string, body: AddMemberBody) => http.post(base(wsId), { schema: MemberDto, body }),
  changeRole: (wsId: string, userId: string, role: WorkspaceRole) =>
    http.patch(one(wsId, userId), { schema: ChangeMemberRoleResponse, body: { role } }),
  /** ADR-119: đặt TOÀN BỘ tập grant (chỉ OWNER); `[]` = thu hồi hết. */
  setGrants: (wsId: string, userId: string, grants: readonly MemberGrant[]) =>
    http.put(`${one(wsId, userId)}/grants`, { schema: MemberDto, body: { grants } }),
  /** Xóa người khác hoặc tự rời (`userId` = chính mình). */
  remove: (wsId: string, userId: string) =>
    http.delete(one(wsId, userId), { schema: RemoveMemberResponse }),
};
