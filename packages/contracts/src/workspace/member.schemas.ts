import * as z from 'zod';

import { Email } from '../auth/auth.schemas';
import { Cursor, IsoDateTime, Uuid, limitQuery, searchQuery } from '../common/primitives';
import { MemberGrant, WorkspaceRole } from '../rbac/permissions';

export const MemberParams = z.object({ wsId: Uuid, userId: Uuid });
export type MemberParams = z.infer<typeof MemberParams>;

/** `q` (ADR-083): trim, ≤ 100, rỗng ⇒ không lọc; khớp tên/email không phân biệt hoa thường. */
export const ListMembersQuery = z.object({
  q: searchQuery(100),
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListMembersQuery = z.infer<typeof ListMembersQuery>;

/** Thêm user đã có tài khoản (lời mời qua email là Phase sau). */
export const AddMemberBody = z.strictObject({ email: Email, role: WorkspaceRole });
export type AddMemberBody = z.infer<typeof AddMemberBody>;

export const ChangeMemberRoleBody = z.strictObject({ role: WorkspaceRole });
export type ChangeMemberRoleBody = z.infer<typeof ChangeMemberRoleBody>;

export const MemberDto = z.object({
  userId: Uuid,
  email: z.string(),
  fullName: z.string(),
  role: WorkspaceRole,
  /** ADR-119; OWNER luôn `[]`. Đổi role sang VIEWER / OWNER ⇒ `[]` (xóa trong cùng transaction). */
  grants: z.array(MemberGrant),
  joinedAt: IsoDateTime,
});
export type MemberDto = z.infer<typeof MemberDto>;

/**
 * `PUT /workspaces/:wsId/members/:userId/grants` (`hr:grant` — chỉ OWNER). Đặt TOÀN BỘ tập grant
 * (idempotent); `[]` = thu hồi hết. Cấp cho OWNER / VIEWER ⇒ 422 `GRANT_NOT_ALLOWED`. Trả `MemberDto`.
 */
export const SetMemberGrantsBody = z.strictObject({
  grants: z.array(MemberGrant).max(MemberGrant.options.length),
});
export type SetMemberGrantsBody = z.infer<typeof SetMemberGrantsBody>;

/** `unassignedTaskCount > 0` khi hạ xuống VIEWER (ADR-044). */
export const ChangeMemberRoleResponse = z.object({
  member: MemberDto,
  unassignedTaskCount: z.int().min(0),
});
export type ChangeMemberRoleResponse = z.infer<typeof ChangeMemberRoleResponse>;

export const RemoveMemberResponse = z.object({
  userId: Uuid,
  unassignedTaskCount: z.int().min(0),
});
export type RemoveMemberResponse = z.infer<typeof RemoveMemberResponse>;
