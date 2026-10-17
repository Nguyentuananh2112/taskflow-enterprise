import {
  ChangeMemberRoleResponse,
  MemberDto,
  RemoveMemberResponse,
  type AddMemberBody,
} from '@taskflow/contracts/workspace';
import { MemberCandidateDto } from '@taskflow/contracts/company';
import type { WorkspaceRole } from '@taskflow/contracts/rbac';
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
  /**
   * Mốc 3.5 (ADR-134): nhân viên công ty chưa ở workspace, khớp tên / email (`q` 2..100, ≤ 20 người) — chọn để thêm.
   */
  candidates: (wsId: string, q: string) =>
    http.get(`/workspaces/${encodeURIComponent(wsId)}/member-candidates`, {
      schema: z.array(MemberCandidateDto),
      query: { q },
    }),
  /** Thêm theo `userId` (từ `candidates`) — không gõ email tự do. */
  add: (wsId: string, body: AddMemberBody) => http.post(base(wsId), { schema: MemberDto, body }),
  changeRole: (wsId: string, userId: string, role: WorkspaceRole) =>
    http.patch(one(wsId, userId), { schema: ChangeMemberRoleResponse, body: { role } }),
  /** Xóa người khác hoặc tự rời (`userId` = chính mình). */
  remove: (wsId: string, userId: string) =>
    http.delete(one(wsId, userId), { schema: RemoveMemberResponse }),
};
