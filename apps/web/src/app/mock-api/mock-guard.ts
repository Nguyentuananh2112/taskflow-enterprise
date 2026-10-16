import type { MembershipDto } from '@taskflow/contracts/auth';
import { Uuid } from '@taskflow/contracts/common';
import { hasPermission, roleHasPermission, type Permission } from '@taskflow/contracts/rbac';

import type { MockDb } from './mock-db';
import { fail } from './respond';

// Chặn theo đúng thứ tự của API thật (data-and-api §2.2): 401 → 400 params → 404 (không phải
// thành viên / khác tenant) → 403 thiếu quyền → 422 luật → 409 version.

type MockUser = NonNullable<ReturnType<MockDb['getUser']>>;
type Guarded<T> = { ok: T; response?: never } | { response: Response; ok?: never };

/** Bearer ⇒ user, hoặc 401 đúng mã (TOKEN_EXPIRED chỉ khi token hết hạn). */
export function authenticate(request: Request, db: MockDb): Guarded<MockUser> {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  const result = token ? db.verifyAccess(token) : { status: 'invalid' as const };
  if (result.status === 'ok') return { ok: result.user };
  return {
    response: result.status === 'expired' ? fail(401, 'TOKEN_EXPIRED') : fail(401, 'UNAUTHORIZED'),
  };
}

export type MemberContext = Readonly<{ user: MockUser; membership: MembershipDto }>;

/** Đăng nhập + id hợp lệ + là thành viên workspace. Không phải thành viên ⇒ 404 (ADR-020). */
export function requireMember(
  request: Request,
  db: MockDb,
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): Guarded<MemberContext> {
  const auth = authenticate(request, db);
  if (auth.response) return auth;
  for (const [name, value] of Object.entries(params)) {
    if (!Uuid.safeParse(value).success) {
      return {
        response: fail(400, 'VALIDATION_ERROR', {
          issues: [{ path: [name], code: 'invalid_format', message: 'Không phải UUID hợp lệ' }],
        }),
      };
    }
  }
  const membership = db.membershipIn(auth.ok.id, String(params.wsId));
  if (!membership) return { response: fail(404, 'RESOURCE_NOT_FOUND', { resource: 'workspace' }) };
  return { ok: { user: auth.ok, membership } };
}

/** 403 khi role thiếu permission (min role ở middleware). */
export function forbiddenUnless(ctx: MemberContext, permission: Permission): Response | null {
  return roleHasPermission(ctx.membership.role, permission)
    ? null
    : fail(403, 'FORBIDDEN_ACCESS', { required: permission });
}

/** `X-Client-Id` → `originClientId` của event (không phải uuid ⇒ null — T-002 §5.2). */
export function originClientId(request: Request): string | null {
  const value = request.headers.get('x-client-id');
  return Uuid.safeParse(value).success ? value : null;
}

/**
 * 403 khi quyền HIỆU LỰC (role ∪ grants — ADR-119) thiếu `permission`; đọc grants mới nhất mỗi request
 * (thu quyền có hiệu lực ngay — B-H3).
 */
export function forbiddenUnlessGranted(
  ctx: MemberContext,
  db: MockDb,
  permission: Permission,
): Response | null {
  const grants = db.workspaces.member(ctx.membership.workspaceId, ctx.user.id)?.grants ?? [];
  return hasPermission(ctx.membership.role, grants, permission)
    ? null
    : fail(403, 'FORBIDDEN_ACCESS', { required: permission });
}
